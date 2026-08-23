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

      <H>What the interconnect actually costs</H>
      <P>
        The box above says the link sets the floor. The number behind that: on this rig a KV transfer
        crosses <Code>{run.rig.interconnect ?? 'PCIe'}</Code>, and the whole point of measuring the cold
        path was to isolate what that hop costs when there is no contention to hide it. At one request
        in flight the transfer is the <em>only</em> difference between the two modes, which makes the
        cold-path gap a direct read on the interconnect rather than on the scheduler.
      </P>
      <P>
        That is also the honest scope of every "disaggregation is faster" claim on this page: it holds
        above some load, on this link. Move the same split onto NVLink-connected devices and the
        crossover point drops, because the thing being amortized got cheaper. The measurements here
        are a floor.
      </P>

      <H>The warm floor is the real design question</H>
      <P>
        Given that waking needs an accelerator to come back to, the interesting question is not how to
        avoid a warm floor but how small it can be. That is what the wake-time measurements are for:
        the floor has to be large enough to cover the gap between "a request arrived" and "an engine
        can answer it", so every second shaved off the restore path is a second of capacity you no
        longer have to pay to keep idle.
      </P>
      <P>
        Which is why the snapshot mechanism matters more than it first appears, and why the distinction
        between them is not pedantic. Releasing memory occupation is fast but keeps the process — and
        therefore the pod, and therefore the bill — alive; it shrinks the floor's latency, not its cost.
        A checkpoint that frees the machine entirely is the one that changes the economics, and it is
        also the one most likely to be blocked by the container it has to run in.
      </P>

      <H>What I would want to measure next</H>
      <P>
        Three things this does not yet answer. <Strong>One:</Strong> the same split over NVLink instead
        of PCIe, to separate the disaggregation win from the interconnect penalty — the numbers here
        are a floor, not a ceiling. <Strong>Two:</Strong> prefix caching over a hybrid
        attention model, where part of the state is a recurrent checkpoint rather than a KV block, and
        the reuse rules stop being a simple tree. <Strong>Three:</Strong> what the prefill:decode ratio
        should be under a realistic mixture of agent traffic rather than three hand-picked shapes,
        because the ratio is the actual product decision and everything above is only evidence for how
        to choose it.
      </P>
    </div>
  );
};

export default Writeup;
