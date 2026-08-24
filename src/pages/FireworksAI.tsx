import { motion } from 'framer-motion';
import { usePageAnalytics } from '../hooks/usePageAnalytics';
import { useFireworksCaptures } from '../hooks/useFireworksCaptures';
import { useFireworksProject } from '../hooks/useFireworksProject';
import { useFireworksLive } from '../hooks/useFireworksLive';
import CacheCliffChart from '../components/fireworks/CacheCliffChart';
import LiveRunPanel from '../components/fireworks/LiveRunPanel';
import PoolUtilizationChart from '../components/fireworks/PoolUtilizationChart';
import RunBadge from '../components/fireworks/RunBadge';
import TailLatencyChart from '../components/fireworks/TailLatencyChart';
import Writeup from '../components/fireworks/Writeup';
import Workbench from '../components/fireworks/Workbench';
import { SERIES_VARS } from '../components/fireworks/chartTokens';
import { phaseTimeline } from '../components/fireworks/phases';

const Section = ({
  eyebrow,
  title,
  blurb,
  children,
}: {
  eyebrow: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) => (
  <motion.section
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-80px' }}
    transition={{ duration: 0.5 }}
    className="mb-16"
  >
    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#001F3F]/40 dark:text-white/35">
      {eyebrow}
    </p>
    <h2 className="mb-2 text-2xl font-bold text-[#001F3F] dark:text-white sm:text-3xl">{title}</h2>
    <p className="mb-6 max-w-3xl text-[#001F3F]/70 dark:text-white/65">{blurb}</p>
    <div className="rounded-xl border border-[#001F3F]/10 bg-white p-4 dark:border-white/10 dark:bg-[#001F3F] sm:p-6">
      {children}
    </div>
  </motion.section>
);

/**
 * FireworksAI page - a purpose-built disaggregated inference engine, shown rather
 * than asserted.
 *
 * Route: /spearfishing/fireworks-ai
 *
 * Everything rendered here comes out of a capture file produced by a re-runnable
 * measurement script. Runs that were not measured are badged as placeholders, and
 * the configurations where disaggregation *loses* are published alongside the
 * ones where it wins.
 */
const FireworksAI = () => {
  usePageAnalytics('Fireworks AI - Disaggregated Inference');

  const { active, activePair, mode, setMode, canCompare, loading, error } = useFireworksCaptures();
  const project = useFireworksProject();
  const live = useFireworksLive();

  if (loading || project.loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#001F3F]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-4">
            <div className="h-10 w-2/3 rounded bg-[#001F3F]/10 dark:bg-white/10" />
            <div className="h-64 rounded bg-[#001F3F]/10 dark:bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  if (error || project.error || !active) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#001F3F]">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <h1 className="mb-3 text-2xl font-bold text-[#001F3F] dark:text-white">Could not load the capture data</h1>
          <p className="text-[#001F3F]/70 dark:text-white/65">{error ?? project.error ?? 'No runs found.'}</p>
        </div>
      </div>
    );
  }

  const prefixTokens = active.prefix.approx_tokens.toLocaleString();

  // Both hero panels share the slower run's duration, so flipping the mode
  // toggle compares two runs rather than two differently-stretched pictures.
  const heroDomainMs = Math.max(
    ...[activePair?.colocated, activePair?.disaggregated, active]
      .filter((run): run is NonNullable<typeof run> => Boolean(run))
      .map((run) => phaseTimeline(run, 'set2').durationMs),
  );

  return (
    <div className={`min-h-screen bg-white dark:bg-[#001F3F] ${SERIES_VARS}`}>
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
        {/* ---------------------------------------------------------- header */}
        <motion.header
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-10"
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#001F3F]/40 dark:text-white/35">
            Inference systems
          </p>
          <h1 className="mb-4 text-4xl font-bold text-[#001F3F] dark:text-white sm:text-5xl">
            A purpose-built disaggregated inference engine
          </h1>
          <p className="max-w-3xl text-lg text-[#001F3F]/70 dark:text-white/65">
            Serving a coding agent is two jobs with opposite shapes. Reading a {prefixTokens}-token project is
            compute-bound and happens once; writing the patch is memory-bound and happens one token at a time. Run
            them on the same GPUs and every scheduling choice is a compromise, so I split them across two H100s and
            measured it against a colocated baseline on the same hardware.
          </p>
          <p className="mt-3 max-w-3xl text-lg text-[#001F3F]/70 dark:text-white/65">
            <strong className="font-semibold text-[#001F3F] dark:text-white">
              Disaggregation lost, on almost every axis.
            </strong>{' '}
            Everything below is that measurement — what it did, why the obvious explanation turned out to be wrong,
            and what it says about when the technique is actually the right call.
          </p>
        </motion.header>

        <div className="mb-10 space-y-3">
          <RunBadge run={active} />
          {canCompare && (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-[#001F3F]/45 dark:text-white/40">serving mode:</span>
              <div className="inline-flex overflow-hidden rounded-lg border border-[#001F3F]/15 dark:border-white/15">
                {(['disaggregated', 'colocated'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={`px-3 py-1.5 transition-colors ${
                      mode === value
                        ? 'bg-[#001F3F] font-semibold text-white dark:bg-white dark:text-[#001F3F]'
                        : 'text-[#001F3F]/65 hover:bg-[#001F3F]/[0.05] dark:text-white/60 dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <span className="text-[#001F3F]/40 dark:text-white/35">
                same rig, same model — only the split changes
              </span>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------ hero */}
        <Section
          eyebrow="What the split does"
          title="Two pools, doing less than one"
          blurb="A long prefill and a long decode, issued together, measured in both modes on the same two H100s. The split gives each phase its own device and its own scheduler — and on this rig it made everything slower. The toggle above switches between the two real runs."
        >
          <PoolUtilizationChart run={active} domainMs={heroDomainMs} />
        </Section>

        {/* ------------------------------------------------------- workbench */}
        <Section
          eyebrow="Try it"
          title="The project is also the prompt"
          blurb="This is the codebase the engine is serving — about 2,100 lines of a working document-summarizing agent. It is fed inline as one string, exactly the way a coding agent passes context. Pick a prompt and watch the patch land at its real recorded speed."
        >
          <Workbench
            run={active}
            files={project.files}
            fileMap={project.fileMap}
            canonicalText={project.canonicalText}
            dirtyPaths={project.dirtyPaths}
            prefixDiverged={project.prefixDiverged}
            cacheableFraction={project.cacheableFraction}
            applyEdit={project.applyEdit}
            resetProject={project.resetProject}
          />
        </Section>

        {/* ----------------------------------------------------- cache cliff */}
        <Section
          eyebrow="Prefix caching"
          title="Pay for the project once"
          blurb="Three different questions about the same project. The prefix is identical across all three, so after the first request the engine already holds its keys and values. This is the one thing that worked exactly as intended — and note how much smaller the win looks on hardware fast enough to make the prefill cheap anyway."
        >
          <CacheCliffChart run={active} />
        </Section>

        {/* ---------------------------------------------------- tail latency */}
        {activePair && (
          <Section
            eyebrow="Tail latency"
            title="Where the split was supposed to pay"
            blurb="Eight short requests at once, nothing shared, nothing cacheable — the case disaggregation exists for. It lost the median and the tail. Eight concurrent requests is simply not enough load on two H100s for phase contention to be the thing that hurts."
          >
            <TailLatencyChart disaggregated={activePair.disaggregated} colocated={activePair.colocated} />
          </Section>
        )}

        {/* --------------------------------------------------------- honesty */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
          className="rounded-xl border border-[#001F3F]/10 bg-[#001F3F]/[0.02] p-6 dark:border-white/10 dark:bg-white/[0.03]"
        >
          <h2 className="mb-4 text-xl font-bold text-[#001F3F] dark:text-white">What the measurement actually said</h2>
          <ul className="space-y-3 text-[#001F3F]/75 dark:text-white/70">
            <li>
              <strong className="font-semibold text-[#001F3F] dark:text-white">Disaggregation lost.</strong>{' '}
              Time to first token on a {prefixTokens}-token prefix: <strong>478ms colocated, 6,233ms
              disaggregated</strong>. Eight concurrent short requests: 88ms p50 against 207ms. It won one thing —
              inter-token p99, by 2.7ms.
            </li>
            <li>
              <strong className="font-semibold text-[#001F3F] dark:text-white">
                It was not the interconnect, which is what I expected.
              </strong>{' '}
              The engine's own counters put KV transfer at <strong>0.75ms per request</strong> across NVLink. The
              cache moved essentially for free. Every argument that begins "the link between the pools is the
              floor" is wrong here, and I had written one before measuring.
            </li>
            <li>
              <strong className="font-semibold text-[#001F3F] dark:text-white">
                Two GPUs is the wrong size for this technique.
              </strong>{' '}
              Each disaggregated worker runs at tensor-parallel 1; the colocated baseline runs both cards on every
              request at tensor-parallel 2. Splitting a two-GPU box gives up half the parallelism per request to buy
              isolation that nothing at this scale needed. That accounts for roughly 2× of a 13× gap; the rest is
              orchestration around chunked prefill, which I did not profile and will not guess at.
            </li>
            <li>
              <strong className="font-semibold text-[#001F3F] dark:text-white">Sparsity buys math, not memory.</strong>{' '}
              Each worker held <strong>59GB</strong> of the same weights — the arithmetic that makes two GPUs the
              minimum. A {active.model.total_params_b ?? '30.5'}B model with{' '}
              {active.model.active_params_b ?? '3.3'}B active still has to hold all of it resident.
            </li>
          </ul>        </motion.section>

        <div className="my-16">
          <LiveRunPanel live={live} />
        </div>

        {/* --------------------------------------------------------- writeup */}
        <Section
          eyebrow="The argument"
          title="Why any of this is the right shape"
          blurb="The charts are evidence. This is what they are evidence for — and where the reasoning stops."
        >
          <Writeup run={active} />
        </Section>

      </div>
    </div>
  );
};

export default FireworksAI;
