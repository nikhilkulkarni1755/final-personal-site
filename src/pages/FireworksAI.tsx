import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { usePageAnalytics } from '../hooks/usePageAnalytics';
import { useFireworksProject } from '../hooks/useFireworksProject';
import { useFireworksLive } from '../hooks/useFireworksLive';
import { useFireworksQuota } from '../hooks/useFireworksQuota';
import { useFireworksRuns } from '../hooks/useFireworksRuns';
import RunsTable from '../components/fireworks/RunsTable';
import Writeup from '../components/fireworks/Writeup';
import Workbench from '../components/fireworks/Workbench';

const Section = ({
  eyebrow,
  title,
  blurb,
  children,
}: {
  eyebrow: string;
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) => (
  <motion.section
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-80px' }}
    transition={{ duration: 0.5 }}
    className="mb-8"
  >
    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#001F3F]/40 dark:text-white/35">
      {eyebrow}
    </p>
    <h2 className="mb-2 text-2xl font-bold text-[#001F3F] dark:text-white sm:text-3xl">{title}</h2>
    {blurb && <p className="mb-4 text-[#001F3F]/70 dark:text-white/65">{blurb}</p>}
    <div className="rounded-xl border border-[#001F3F]/10 bg-white p-4 dark:border-white/10 dark:bg-[#001F3F] sm:p-6">
      {children}
    </div>
  </motion.section>
);

const COLD_START = [
  ['Container start', '~12s'],
  ['SGLang init', '~43s'],
  ['Weights from host cache', '~11s'],
  ['CUDA graph capture', '~36s'],
  ['Warmup', '~11s'],
  ['Total', '≈116s'],
];

/**
 * FireworksAI page - an agent served by a rented GPU, end to end.
 *
 * Route: /inference-end-to-end
 */
const FireworksAI = () => {
  usePageAnalytics('Inference, end to end');

  const project = useFireworksProject();
  const live = useFireworksLive();
  const quota = useFireworksQuota();
  const runs = useFireworksRuns();
  const [promptResult, setPromptResult] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  const runPrompt = useCallback(
    async (prompt: string) => {
      setLastPrompt(prompt);
      setPromptResult(null);
      const outcome = await live.submitPrompt(prompt, project);
      void quota.refresh();
      void runs.refresh();
      setPromptResult(
        outcome.kind === 'applied'
          ? `Applied to ${outcome.paths.join(', ')}: ${outcome.summary}`
          : outcome.kind === 'no_change'
            ? `No file changed: ${outcome.summary}`
            : outcome.kind === 'out_of_scope'
              ? 'out of scope — this model only edits the project above.'
              : outcome.message,
      );
    },
    [live, project, quota, runs],
  );

  // A wake that found no GPU is our capacity problem, so the page watches for a
  // free card on the visitor's behalf: the quota route carries the worker
  // states, and refreshing it every 15s costs nothing and counts nothing.
  const waitingForGpu = !live.busy && (live.failure === 'no_gpu' || live.failure === 'wake_timeout');
  useEffect(() => {
    if (!waitingForGpu) return;
    const timer = window.setInterval(() => void quota.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [waitingForGpu, quota]);

  if (project.loading) {
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

  if (project.error) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#001F3F]">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <h1 className="mb-3 text-2xl font-bold text-[#001F3F] dark:text-white">Could not load the capture data</h1>
          <p className="text-[#001F3F]/70 dark:text-white/65">{project.error}</p>
        </div>
      </div>
    );
  }

  // What the input box can offer right now. Kept in one place because the
  // answer depends on several independent things -- whether a gateway exists
  // at all, whether this address has inputs left, whether today's budget does,
  // whether a GPU is free, and whether the engine is still warm -- and
  // scattering that logic across the UI is how the states drift.
  const promptState = (() => {
    if (!live.available) {
      return { enabled: false, note: 'No engine is configured for this deployment, so the box is closed.' };
    }
    if (quota.unavailable) {
      return { enabled: false, note: 'The budget is unavailable right now, so the box is closed.' };
    }
    if (quota.remaining <= 0) {
      return { enabled: false, note: `You have used all ${quota.limit} inputs for this address.` };
    }
    if (quota.dailyRemaining <= 0) {
      return { enabled: false, note: 'Today’s GPU budget is spent. It resets at midnight UTC.' };
    }
    if (live.busy) {
      return { enabled: false, note: live.phase === 'waking' ? 'Waking a GPU from zero — a couple of minutes.' : `Turn ${live.turn} of ${quota.turnCap}.` };
    }
    const left = `${quota.remaining} of ${quota.limit} inputs left for this address; each one is a whole run of up to ${quota.turnCap} tool calls, and you cannot amend it once sent.`;
    if (quota.noGpu) {
      return { enabled: false, note: `No GPU is free for this endpoint right now — the worker is throttled. ${left}` };
    }
    if (quota.warmFor > 0) {
      return { enabled: true, note: `${left} The engine is warm for about ${quota.warmFor}s more, so the next one starts at once.` };
    }
    return { enabled: true, note: `${left} The engine is asleep, so the first one wakes it.` };
  })();

  return (
    <div className={`min-h-screen bg-white dark:bg-[#001F3F]`}>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* ---------------------------------------------------------- header */}
        <motion.header
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-6 text-center"
        >
          <h1 className="mb-2 text-3xl font-bold text-[#001F3F] dark:text-white sm:text-4xl">Inference end to end</h1>
          <p className="text-lg text-[#001F3F]/70 dark:text-white/65">
            This is a demo for LLM inference from client to GPU and back. Ask the LLM to make the robot green, or add a
            button for dark mode. You can watch the system find a rented GPU, initialize SGLang and run tool calls to
            complete the task.
          </p>
        </motion.header>

        {/* ------------------------------------------------------- workbench */}
        <Section
          eyebrow="Try it"
          title="The codebase it works on"
          blurb="The model is never fed the codebase. It sees the file tree and six tools (ls, grep, read, replace, append, write) and pulls in only what it needs. Edits land in this tab at once."
        >
          <Workbench
            files={project.files}
            fileMap={project.fileMap}
            canonicalText={project.canonicalText}
            dirtyPaths={project.dirtyPaths}
            prefixDiverged={project.prefixDiverged}
            applyEdit={project.applyEdit}
            resetProject={project.resetProject}
            live={live}
            promptEnabled={promptState.enabled}
            promptNote={promptState.note}
            promptResult={promptResult}
            onSubmitPrompt={(prompt) => void runPrompt(prompt)}
            resend={waitingForGpu && lastPrompt ? { ready: !quota.noGpu, onClick: () => void runPrompt(lastPrompt) } : null}
          />
        </Section>

        {/* ----------------------------------------------------------- runs */}
        <Section
          eyebrow="Every run"
          title="The dataset this page is building"
          blurb="One row per input anyone has sent, measured by the gateway and never edited."
        >
          <RunsTable rows={runs.rows} />
        </Section>

        <Section
          eyebrow="Cold start"
          title="Waking a GPU from zero"
          blurb="Measured on an H100 serving Qwen3-Coder 30B. Once the engine is warm, a turn starts in 123 to 382ms."
        >
          <table className="w-full text-sm text-[#001F3F]/75 dark:text-white/70">
            <tbody>
              {COLD_START.map(([stage, seconds]) => (
                <tr key={stage} className="border-b border-[#001F3F]/10 last:border-0 dark:border-white/10">
                  <td className="py-2">{stage}</td>
                  <td className="py-2 text-right font-mono">{seconds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section eyebrow="Engineering decisions" title="Why it is built this way">
          <Writeup />
        </Section>
      </div>
    </div>
  );
};

export default FireworksAI;
