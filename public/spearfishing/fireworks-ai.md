# A purpose-built disaggregated inference engine

Inference systems

Serving a coding agent is two jobs with opposite shapes. Reading a -token project is compute-bound and happens once; writing the patch is memory-bound and happens one token at a time. Run them on the same GPUs and every scheduling choice is a compromise, so I split them across two H100s and measured it against a colocated baseline on the same hardware.

**Disaggregation lost, on almost every axis.** Everything below is that measurement — what it did, why the obvious explanation turned out to be wrong, and what it says about when the technique is actually the right call.

· ×  ·  ·

What the split does

## Two pools, doing less than one

A long prefill and a long decode, issued together, measured in both modes on the same two H100s. The split gives each phase its own device and its own scheduler — and on this rig it made everything slower. The toggle above switches between the two real runs.

Two requests issued together. Each bar is one request: reading its prompt, then writing its answer —
            derived from the recorded time-to-first-token and every inter-token gap, so it is measured timing rather
            than a sampled average. It shows *which phase each request was in*, not how busy the GPUs were.
            Both modes share one time axis, so the toggle compares runs rather than two differently-stretched
            pictures. This set finished in .

Try it

## The project is also the prompt

This is the codebase the engine is serving — about 2,100 lines of a working document-summarizing agent. It is fed inline as one string, exactly the way a coding agent passes context. Pick a prompt and watch the patch land at its real recorded speed.

Send
          1×
              2×
              4×
              8×
               reset project

docscribe/

files · lines

frontend/style.css code preview

Prefix caching

## Pay for the project once

Three different questions about the same project. The prefix is identical across all three, so after the first request the engine already holds its keys and values. This is the one thing that worked exactly as intended — and note how much smaller the win looks on hardware fast enough to make the prefill cheap anyway.

Same project, three different questions. The first pays for the whole prefix; the rest reuse it.

## What the measurement actually said

- **Disaggregation lost.** Time to first token on a -token prefix: **478ms colocated, 6,233ms disaggregated**. Eight concurrent short requests: 88ms p50 against 207ms. It won one thing — inter-token p99, by 2.7ms.
- **It was not the interconnect, which is what I expected.** The engine's own counters put KV transfer at **0.75ms per request** across NVLink. The cache moved essentially for free. Every argument that begins "the link between the pools is the floor" is wrong here, and I had written one before measuring.
- **Two GPUs is the wrong size for this technique.** Each disaggregated worker runs at tensor-parallel 1; the colocated baseline runs both cards on every request at tensor-parallel 2. Splitting a two-GPU box gives up half the parallelism per request to buy isolation that nothing at this scale needed. That accounts for roughly 2× of a 13× gap; the rest is orchestration around chunked prefill, which I did not profile and will not guess at.
- **Sparsity buys math, not memory.** Each worker held **59GB** of the same weights — the arithmetic that makes two GPUs the minimum. A 30.5B model with 3.3B active still has to hold all of it resident.

### Run it live

Everything above replays measurements recorded against a real engine. This wakes that engine again and reruns the same harness, so the numbers are checkable rather than merely claimed. It is gated because it spends money: two H100s, torn down automatically after ten minutes.

The argument

## Why any of this is the right shape

The charts are evidence. This is what they are evidence for — and where the reasoning stops.

### Purpose-built means the workload picks the ratio

"Disaggregated" is not a configuration you switch on and benefit from. Splitting prefill from decode buys you two schedulers you can tune independently, and that is only worth the KV transfer if the two halves of your traffic actually want different things. So the design question is not *whether* to split — it is what your token shape says the split should be.

A coding agent has an unusually lopsided shape. Every turn carries the whole project: **tokens of context** against an instruction of maybe twenty, and an answer of a few hundred to a few thousand. Two things follow. Prefill dominates the arithmetic, so a naive prefill:decode ratio of 1:1 leaves the decode pool idling. And the context is *the same every turn*, which means most of that prefill should never happen twice.

That is why the cache result matters more than the split result here. On this workload the radix tree turns a -token prefill into a lookup, and the second request's time-to-first-token falls off a cliff. A purpose-built engine for coding agents is one that treats the shared prefix as the primary object and sizes the prefill pool for cache *misses*, not for the raw token count.

### Serialization order is a caching decision

A radix tree matches on a token sequence, so a cache hit ends at the first byte that differs. Which means the order you serialize a project in quietly decides what an edit costs.

This project is sent in sorted path order. Edit `frontend/style.css`, sorted near the end, and **about 85% of the prefix still matches**. Edit `backend/agent.py`, sorted near the front, and roughly **97% is invalidated** — the same size change, an order of magnitude apart in what it costs to serve. You can watch this happen in the workbench above: the header reports how much of the prefix survives whatever you have edited.

The useful consequence is that a coding agent should not order context alphabetically. It should order it by *how likely each file is to change* — stable dependencies first, the file currently being worked on last — so that the common case invalidates the smallest possible suffix. That is a cheap change to a context builder and it is worth real money at scale.

### The arithmetic that decides your topology

This demo was originally specified for a single 96GB card. That is not possible, and the reason is worth stating plainly: **each PD worker holds a full copy of the weights.** Prefill and decode are different phases of the same model, not different models. Two workers means two copies.

At 61GB of BF16 weights that is 122GB before a single token of KV cache, so a single 80GB device cannot host both roles no matter how the flags are set. The original target — an 80B model at FP8, about 80GB per copy — needed 160GB against a 96GB card. This is a memory-arithmetic problem wearing a configuration problem's clothes, and it is the first thing to check before designing anything else.

### Sparsity buys arithmetic, not capacity

The model here holds 30.5B parameters and activates about 3.3B per token. That ratio is what makes MoE attractive for decode: you are memory-bandwidth-bound, reading weights to produce one token at a time, and a sparse model reads far less per token.

The advantage is not symmetric across the two phases. During prefill many tokens flow through at once and collectively activate most of the experts anyway, so the sparsity win shrinks exactly where the arithmetic is heaviest — which means a sparse model changes the prefill:decode ratio you should be provisioning for. Decode gets cheaper per token; prefill largely does not.

Where this goes next is expert placement. Experts are independent, so they can live on different devices — which turns "how do I split prefill from decode" into "how do I keep one device from becoming the hot spot when the router develops a preference". That is a load balancing problem with a learned, drifting distribution, and it is a more interesting one than the PD split.

### I was wrong about the interconnect

Before measuring anything I argued that the link between the pools sets the floor on what disaggregation can win — that these GPUs talk over PCIe, that every KV transfer pays for it, and that the numbers here would therefore be a floor rather than a ceiling.

Both halves were wrong. The rig reports `NV18` — eighteen NVLink connections between the two cards, plus ten InfiniBand devices. And the engine's own counters put KV transfer at **0.75ms per request**, with bootstrap at another 0.73ms. Moving the cache is free at this scale. Whatever cost disaggregation 5.7 seconds of time-to-first-token, it was not the wire.

Leaving that here rather than quietly deleting it, because the shape of the mistake is the useful part: it is an argument that sounds right, follows from real systems knowledge, and would have survived indefinitely on a page that never measured anything. The counter that refuted it took one line to read.

### What it actually was: the split costs parallelism

The colocated baseline runs both H100s on every request at tensor-parallel 2. The disaggregated configuration runs one card for prefill and one for decode, each at tensor-parallel 1. **Splitting a two-GPU box halves the compute available to any single request** in exchange for isolating the phases from each other.

That trade only pays when phase contention is what hurts — which needs enough concurrency that a long prefill is genuinely blocking somebody's decode, and enough GPUs that each pool still has real parallelism after the split. Eight concurrent requests on two H100s is not that. There was nothing to isolate, so the split bought nothing and cost half the machine.

Which explains roughly 2× of a 13× gap. The remainder scales with prefill length — a short burst costs ~120ms extra, a -token prefix costs ~5.7s — and prefill is chunked at 8,192 tokens, so a long prompt pays whatever per-chunk orchestration exists several times over. I did not profile it further, so that is where the explanation stops rather than where the speculation starts.

### Scale-to-zero costs 800 seconds

Cold start, measured end to end: **474 seconds** to provision a machine and pull a 21GB image, **200 seconds** to fetch 61GB of weights, **124 seconds** to load sixteen shards and capture CUDA graphs. Thirteen minutes from nothing to first token.

The proportions are what matter. **The part a snapshot can address is the smallest one.** Restoring a checkpointed process replaces the 124 seconds and does nothing about the 674 spent getting the image and the weights onto the machine. "Wake in seconds" is only true once you are already paying to keep both resident — which is a warm floor, the exact thing scale-to-zero is supposed to avoid.

The half that does work is worth having. With `--enable-memory-saver`, releasing the accelerator took **~64ms** and resuming took **~127ms**, moving 70GB of GPU memory each way, serving again about 105ms later. But the process stayed alive the whole time, so the pod stayed alive, so the bill kept running. It frees the accelerator, not the rental. That makes a warm floor cheaper to hold, which given a 13-minute cold start is genuinely useful — and it is not scale-to-zero, and calling it that would be the kind of claim this page exists to avoid.

### What I would want to measure next

**One:** the same comparison at a size where the technique should win — enough GPUs that each pool keeps real tensor parallelism after the split, and enough concurrency that phase contention is actually the bottleneck. That is the experiment that would tell me whether 13× is a property of this configuration or of my implementation, and it is the obvious next thing to run.

**Two:** where the remaining seconds go. KV transfer is ruled out and tensor parallelism explains about 2×; the rest is orchestration around chunked prefill and wants a profiler rather than another chart.

**Three:** prefix caching over a hybrid attention model, where part of the state is a recurrent checkpoint rather than a KV block and the reuse rules stop being a simple tree. And **four:** what the prefill:decode ratio should be under a realistic mixture of agent traffic rather than three hand-picked shapes — that ratio is the actual product decision, and everything above is only evidence for how to choose it.
