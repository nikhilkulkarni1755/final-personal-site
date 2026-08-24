import type { CaptureRun } from './types';

const H = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-2 mt-8 text-lg font-bold text-[#001F3F] first:mt-0 dark:text-white">{children}</h3>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-3 max-w-3xl text-[15px] leading-relaxed text-[#001F3F]/75 dark:text-white/70">{children}</p>
);

const Strong = ({ children }: { children: React.ReactNode }) => (
  <strong className="font-semibold text-[#001F3F] dark:text-white">{children}</strong>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-[#001F3F]/[0.06] px-1 py-0.5 font-mono text-[13px] text-[#001F3F]/85 dark:bg-white/10 dark:text-white/85">
    {children}
  </code>
);

/**
 * Writeup - the argument the charts are evidence for.
 *
 * Deliberately placed last. A reader who stops after thirty seconds has already
 * seen the thing that matters; this is for the one who wants to know whether the
 * numbers were understood or merely produced.
 */
const Writeup = ({ run }: { run: CaptureRun }) => {
  const prefixTokens = run.prefix.approx_tokens.toLocaleString();
  const weights = run.model.weights_gb ?? 61;
  const memory = run.rig.gpu_memory_gb ?? 80;

  return (
    <div>
      <H>Purpose-built means the workload picks the ratio</H>
      <P>
        "Disaggregated" is not a configuration you switch on and benefit from. Splitting prefill from
        decode buys you two schedulers you can tune independently, and that is only worth the KV
        transfer if the two halves of your traffic actually want different things. So the design
        question is not <em>whether</em> to split — it is what your token shape says the split should
        be.
      </P>
      <P>
        A coding agent has an unusually lopsided shape. Every turn carries the whole project:{' '}
        <Strong>{prefixTokens} tokens of context</Strong> against an instruction of maybe twenty, and
        an answer of a few hundred to a few thousand. Two things follow. Prefill dominates the
        arithmetic, so a naive prefill:decode ratio of 1:1 leaves the decode pool idling. And the
        context is <em>the same every turn</em>, which means most of that prefill should never happen
        twice.
      </P>
      <P>
        That is why the cache result matters more than the split result here. On this workload the
        radix tree turns a {prefixTokens}-token prefill into a lookup, and the second request's
        time-to-first-token falls off a cliff. A purpose-built engine for coding agents is one that
        treats the shared prefix as the primary object and sizes the prefill pool for cache
        <em> misses</em>, not for the raw token count.
      </P>

      <H>Serialization order is a caching decision</H>
      <P>
        A radix tree matches on a token sequence, so a cache hit ends at the first byte that differs.
        Which means the order you serialize a project in quietly decides what an edit costs.
      </P>
      <P>
        This project is sent in sorted path order. Edit <Code>frontend/style.css</Code>, sorted near the
        end, and <Strong>about 85% of the prefix still matches</Strong>. Edit{' '}
        <Code>backend/agent.py</Code>, sorted near the front, and roughly <Strong>97% is
        invalidated</Strong> — the same size change, an order of magnitude apart in what it costs to
        serve. You can watch this happen in the workbench above: the header reports how much of the
        prefix survives whatever you have edited.
      </P>
      <P>
        The useful consequence is that a coding agent should not order context alphabetically. It
        should order it by <em>how likely each file is to change</em> — stable dependencies first,
        the file currently being worked on last — so that the common case invalidates the smallest
        possible suffix. That is a cheap change to a context builder and it is worth real money at
        scale.
      </P>

      <H>The arithmetic that decides your topology</H>
      <P>
        This demo was originally specified for a single 96GB card. That is not possible, and the
        reason is worth stating plainly: <Strong>each PD worker holds a full copy of the weights.</Strong>{' '}
        Prefill and decode are different phases of the same model, not different models. Two workers
        means two copies.
      </P>
      <P>
        At {weights}GB of BF16 weights that is {weights * 2}GB before a single token of KV cache, so a
        single {memory}GB device cannot host both roles no matter how the flags are set. The original
        target — an 80B model at FP8, about 80GB per copy — needed 160GB against a 96GB card. This is
        a memory-arithmetic problem wearing a configuration problem's clothes, and it is the first
        thing to check before designing anything else.
      </P>

      <H>Sparsity buys arithmetic, not capacity</H>
      <P>
        The model here holds {run.model.total_params_b ?? '30.5'}B parameters and activates about{' '}
        {run.model.active_params_b ?? '3.3'}B per token. That ratio is what makes MoE attractive for
        decode: you are memory-bandwidth-bound, reading weights to produce one token at a time, and a
        sparse model reads far less per token.
      </P>
      <P>
        The advantage is not symmetric across the two phases. During prefill many tokens flow through
        at once and collectively activate most of the experts anyway, so the sparsity win shrinks
        exactly where the arithmetic is heaviest — which means a sparse model changes the
        prefill:decode ratio you should be provisioning for. Decode gets cheaper per token; prefill
        largely does not.
      </P>
      <P>
        Where this goes next is expert placement. Experts are independent, so they can live on
        different devices — which turns "how do I split prefill from decode" into "how do I keep one
        device from becoming the hot spot when the router develops a preference". That is a load
        balancing problem with a learned, drifting distribution, and it is a more interesting one than
        the PD split.
      </P>

      <H>I was wrong about the interconnect</H>
      <P>
        Before measuring anything I argued that the link between the pools sets the floor on what
        disaggregation can win — that these GPUs talk over PCIe, that every KV transfer pays for it,
        and that the numbers here would therefore be a floor rather than a ceiling.
      </P>
      <P>
        Both halves were wrong. The rig reports <Code>NV18</Code> — eighteen NVLink connections
        between the two cards, plus ten InfiniBand devices. And the engine's own counters put KV
        transfer at <Strong>0.75ms per request</Strong>, with bootstrap at another 0.73ms. Moving the
        cache is free at this scale. Whatever cost disaggregation 5.7 seconds of time-to-first-token,
        it was not the wire.
      </P>
      <P>
        Leaving that here rather than quietly deleting it, because the shape of the mistake is the
        useful part: it is an argument that sounds right, follows from real systems knowledge, and
        would have survived indefinitely on a page that never measured anything. The counter that
        refuted it took one line to read.
      </P>

      <H>What it actually was: the split costs parallelism</H>
      <P>
        The colocated baseline runs both H100s on every request at tensor-parallel 2. The
        disaggregated configuration runs one card for prefill and one for decode, each at
        tensor-parallel 1. <Strong>Splitting a two-GPU box halves the compute available to any single
        request</Strong> in exchange for isolating the phases from each other.
      </P>
      <P>
        That trade only pays when phase contention is what hurts — which needs enough concurrency
        that a long prefill is genuinely blocking somebody's decode, and enough GPUs that each pool
        still has real parallelism after the split. Eight concurrent requests on two H100s is not
        that. There was nothing to isolate, so the split bought nothing and cost half the machine.
      </P>
      <P>
        Which explains roughly 2× of a 13× gap. The remainder scales with prefill length — a short
        burst costs ~120ms extra, a {prefixTokens}-token prefix costs ~5.7s — and prefill is chunked
        at 8,192 tokens, so a long prompt pays whatever per-chunk orchestration exists several times
        over. I did not profile it further, so that is where the explanation stops rather than where
        the speculation starts.
      </P>

      <H>Scale-to-zero costs 800 seconds</H>
      <P>
        Cold start, measured end to end: <Strong>474 seconds</Strong> to provision a machine and pull
        a 21GB image, <Strong>200 seconds</Strong> to fetch 61GB of weights, <Strong>124 seconds</Strong>{' '}
        to load sixteen shards and capture CUDA graphs. Thirteen minutes from nothing to first token.
      </P>
      <P>
        The proportions are what matter. <Strong>The part a snapshot can address is the smallest
        one.</Strong> Restoring a checkpointed process replaces the 124 seconds and does nothing
        about the 674 spent getting the image and the weights onto the machine. "Wake in seconds" is
        only true once you are already paying to keep both resident — which is a warm floor, the
        exact thing scale-to-zero is supposed to avoid.
      </P>
      <P>
        The half that does work is worth having. With <Code>--enable-memory-saver</Code>, releasing
        the accelerator took <Strong>~64ms</Strong> and resuming took <Strong>~127ms</Strong>, moving
        70GB of GPU memory each way, serving again about 105ms later. But the process stayed alive
        the whole time, so the pod stayed alive, so the bill kept running. It frees the accelerator,
        not the rental. That makes a warm floor cheaper to hold, which given a 13-minute cold start
        is genuinely useful — and it is not scale-to-zero, and calling it that would be the kind of
        claim this page exists to avoid.
      </P>

      <H>What I would want to measure next</H>
      <P>
        <Strong>One:</Strong> the same comparison at a size where the technique should win — enough
        GPUs that each pool keeps real tensor parallelism after the split, and enough concurrency that
        phase contention is actually the bottleneck. That is the experiment that would tell me whether
        13× is a property of this configuration or of my implementation, and it is the obvious next
        thing to run.
      </P>
      <P>
        <Strong>Two:</Strong> where the remaining seconds go. KV transfer is ruled out and tensor
        parallelism explains about 2×; the rest is orchestration around chunked prefill and wants a
        profiler rather than another chart.
      </P>
      <P>
        <Strong>Three:</Strong> prefix caching over a hybrid attention model, where part of the state
        is a recurrent checkpoint rather than a KV block and the reuse rules stop being a simple tree.
        And <Strong>four:</Strong> what the prefill:decode ratio should be under a realistic mixture of
        agent traffic rather than three hand-picked shapes — that ratio is the actual product decision,
        and everything above is only evidence for how to choose it.
      </P>
    </div>
  );
};

export default Writeup;
