import { motion } from 'framer-motion';
import { usePageAnalytics } from '../hooks/usePageAnalytics';
import { useFireworksCaptures } from '../hooks/useFireworksCaptures';
import { useFireworksProject } from '../hooks/useFireworksProject';
import CacheCliffChart from '../components/fireworks/CacheCliffChart';
import PoolUtilizationChart from '../components/fireworks/PoolUtilizationChart';
import RunBadge from '../components/fireworks/RunBadge';
import TailLatencyChart from '../components/fireworks/TailLatencyChart';
import Workbench from '../components/fireworks/Workbench';
import { SERIES_VARS } from '../components/fireworks/chartTokens';

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
            them on the same GPUs and every scheduling choice is a compromise. This page splits them and measures
            what that buys — including where it costs.
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
          eyebrow="The hero"
          title="Two pools, or one bottleneck"
          blurb="A long prefill and a long decode, issued together. Watch what the decode pool is allowed to do while the prefill runs — then flip the toggle above."
        >
          <PoolUtilizationChart run={active} />
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
            applyEdit={project.applyEdit}
            resetProject={project.resetProject}
          />
        </Section>

        {/* ----------------------------------------------------- cache cliff */}
        <Section
          eyebrow="Prefix caching"
          title="Pay for the project once"
          blurb="Three different questions about the same project. The prefix is identical across all three, so after the first request the engine already holds its keys and values and can skip straight to the new tokens."
        >
          <CacheCliffChart run={active} />
        </Section>

        {/* ---------------------------------------------------- tail latency */}
        {activePair && (
          <Section
            eyebrow="Tail latency"
            title="The median is not the problem"
            blurb="Eight short requests at once, nothing shared, nothing cacheable. This is the case where colocated scheduling has to keep choosing between somebody's prefill and somebody else's next token."
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
          <h2 className="mb-4 text-xl font-bold text-[#001F3F] dark:text-white">Where this does not win</h2>
          <ul className="space-y-3 text-[#001F3F]/75 dark:text-white/70">
            <li>
              <strong className="font-semibold text-[#001F3F] dark:text-white">At low load, don't split.</strong>{' '}
              One request at a time has nothing to contend with, so disaggregation only adds a KV cache hop across
              the interconnect. On the cold path above it is pure overhead, and colocated has the better median in
              the tail-latency test too.
            </li>
            <li>
              <strong className="font-semibold text-[#001F3F] dark:text-white">The interconnect decides.</strong>{' '}
              These two GPUs talk over PCIe, not NVLink. Every KV transfer pays for that, so the win here is a
              floor rather than a ceiling — the same split on NVLink-connected devices moves more cache for less.
            </li>
            <li>
              <strong className="font-semibold text-[#001F3F] dark:text-white">
                Scale-to-zero still needs a GPU to come back.
              </strong>{' '}
              Restoring a snapshot is fast; reacquiring a scarce accelerator at an arbitrary moment is not. Any real
              SLO on top of this keeps a warm floor, and the honest version of "costs nothing when idle" is "costs
              nothing when idle, and sometimes makes you wait."
            </li>
            <li>
              <strong className="font-semibold text-[#001F3F] dark:text-white">Sparsity buys math, not memory.</strong>{' '}
              An {active.model.total_params_b ?? '—'}B model with {active.model.active_params_b ?? '—'}B active still
              has to hold every parameter resident. That constraint, not the FLOPs, is what decides how many workers
              fit on a box — and it is why the split needs two GPUs at all.
            </li>
          </ul>
        </motion.section>
      </div>
    </div>
  );
};

export default FireworksAI;
