import { Check, Loader2, Moon, X } from 'lucide-react';
import { formatMs } from './chartTokens';
import { THROTTLE_GRACE_MS, noGpu, type LiveState } from '../../hooks/useFireworksLive';

/**
 * LivePanel - the backend, watched through glass.
 *
 * Every stage here lights from something recorded, never from a guess: the
 * gateway's own frames, RunPod's worker states, the engine's boot counters as
 * they land in the Pushgateway, and the run's turns as the gateway records
 * them. A stage with no signal stays dark. When a worker is throttled the
 * panel says so, which is the scale-to-zero trap shown rather than described.
 */

type Tone = 'dark' | 'active' | 'done' | 'failed';

interface Stage {
  label: string;
  detail: string;
  tone: Tone;
}

const describeWorkers = (live: LiveState): Stage => {
  const w = live.workers;
  const past = live.phase === 'thinking' || live.phase === 'tool' || live.phase === 'done';
  if (past) return { label: 'GPU worker', detail: 'running', tone: 'done' };
  if (live.phase === 'failed') return { label: 'GPU worker', detail: live.message ? 'did not come up' : '', tone: 'failed' };
  if (!w) return { label: 'GPU worker', detail: live.phase === 'waking' ? 'asking RunPod…' : 'asleep', tone: live.phase === 'waking' ? 'active' : 'dark' };
  if (w.running) return { label: 'GPU worker', detail: 'running', tone: 'done' };
  if (noGpu(w)) {
    // The gateway gives up after a minute of this; say so rather than surprise.
    const left = live.throttledSince ? Math.max(0, Math.round((THROTTLE_GRACE_MS - (Date.now() - live.throttledSince)) / 1000)) : null;
    return { label: 'GPU worker', detail: `throttled: no card free on its host${left !== null ? ` · giving up in ${left}s` : ''}`, tone: 'failed' };
  }
  if (w.initializing) return { label: 'GPU worker', detail: 'placed, pulling the image', tone: 'active' };
  if (w.ready || w.idle) return { label: 'GPU worker', detail: 'ready, starting the container', tone: 'active' };
  return { label: 'GPU worker', detail: 'no worker yet', tone: 'active' };
};

const describeEngine = (live: LiveState): Stage => {
  const e = live.engine;
  const past = live.phase === 'thinking' || live.phase === 'tool' || live.phase === 'done';
  if (past) return { label: 'Engine', detail: live.model ? live.model.split('/').pop()! : 'serving', tone: 'done' };
  if (live.phase !== 'waking') return { label: 'Engine', detail: 'not running', tone: live.phase === 'failed' ? 'failed' : 'dark' };
  // No snapshot at all means the Pushgateway did not answer the gateway (seen
  // 2026-09-11: Docker was down on the host); that is not the container's state.
  if (!e) return { label: 'Engine', detail: 'no telemetry reaching the gateway', tone: 'dark' };
  if (e.heartbeat_age_s === null || e.heartbeat_age_s > 30) return { label: 'Engine', detail: 'container not up', tone: 'dark' };
  if (e.startup.scheduler_e2e) return { label: 'Engine', detail: `booted in ${e.startup.scheduler_e2e.toFixed(0)}s, warming up`, tone: 'active' };
  if (e.startup.load_weight) return { label: 'Engine', detail: `weights loaded in ${e.startup.load_weight.toFixed(0)}s, capturing graphs`, tone: 'active' };
  return { label: 'Engine', detail: 'container up, loading weights', tone: 'active' };
};

const describeModel = (live: LiveState): Stage => {
  const calls = live.trace.filter((entry) => entry.kind !== 'final').length;
  if (live.phase === 'idle') return { label: 'Model', detail: 'waiting for an input', tone: 'dark' };
  if (live.phase === 'waking') return { label: 'Model', detail: 'waiting for the engine', tone: 'dark' };
  if (live.phase === 'thinking') return { label: 'Model', detail: `turn ${live.turn}: deciding`, tone: 'active' };
  if (live.phase === 'tool') return { label: 'Model', detail: `turn ${live.turn}: ${live.trace[live.trace.length - 1]?.summary ?? ''}`, tone: 'active' };
  if (live.phase === 'failed') return { label: 'Model', detail: live.message, tone: 'failed' };
  return { label: 'Model', detail: `${calls} tool call${calls === 1 ? '' : 's'} in ${live.turn} turn${live.turn === 1 ? '' : 's'}`, tone: 'done' };
};

const ICON: Record<Tone, React.ReactNode> = {
  dark: <Moon className="h-3 w-3" />,
  active: <Loader2 className="h-3 w-3 animate-spin" />,
  done: <Check className="h-3 w-3" />,
  failed: <X className="h-3 w-3" />,
};

const TONE_CLASS: Record<Tone, string> = {
  dark: 'border-[#001F3F]/10 text-[#001F3F]/40 dark:border-white/10 dark:text-white/35',
  active: 'border-[#001F3F]/40 text-[#001F3F] dark:border-white/40 dark:text-white',
  done: 'border-[#0F7B5A]/40 text-[#0F7B5A] dark:border-[#3DBE8B]/40 dark:text-[#3DBE8B]',
  failed: 'border-[#C2670A]/50 text-[#C2670A] dark:border-[#C87A16]/50 dark:text-[#C87A16]',
};

const LivePanel = ({ live }: { live: LiveState }) => {
  const stages: Stage[] = [
    {
      label: 'Edge',
      detail: live.phase === 'idle' ? 'no input yet' : live.runId ? `run accepted · turn ${live.turn}` : 'checking your budget',
      tone: live.phase === 'idle' ? 'dark' : live.runId ? 'done' : 'active',
    },
    describeWorkers(live),
    describeEngine(live),
    describeModel(live),
  ];

  const engine = live.engine;
  const numbers = [
    live.phase === 'waking' && live.wakeMs !== null ? ['waiting', formatMs(live.wakeMs)] : null,
    live.ttftMs !== null ? ['first token', formatMs(live.ttftMs)] : null,
    live.tpotMs !== null ? ['per token', `${live.tpotMs.toFixed(1)}ms`] : null,
    engine?.gen_throughput ? ['decode', `${engine.gen_throughput.toFixed(0)} tok/s`] : null,
    engine?.token_usage ? ['KV cache', `${Math.round(engine.token_usage * 100)}%`] : null,
    live.e2eMs !== null ? ['whole run', formatMs(live.e2eMs)] : null,
  ].filter((entry): entry is [string, string] => entry !== null);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stages.map((stage) => (
          <div key={stage.label} className={`rounded-md border px-2.5 py-1.5 text-[11px] transition-colors ${TONE_CLASS[stage.tone]}`}>
            <div className="flex items-center gap-1.5 font-semibold">
              {ICON[stage.tone]}
              {stage.label}
            </div>
            <div className="mt-0.5 truncate opacity-80" title={stage.detail}>
              {stage.detail}
            </div>
          </div>
        ))}
      </div>

      {numbers.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-[#001F3F]/60 dark:text-white/55">
          {numbers.map(([label, value]) => (
            <span key={label}>
              <span className="text-[#001F3F]/40 dark:text-white/35">{label} </span>
              {value}
            </span>
          ))}
        </div>
      )}

      {live.trace.length > 0 && (
        <ol className="space-y-0.5 font-mono text-[11px] text-[#001F3F]/70 dark:text-white/65">
          {live.trace.map((entry, index) => (
            <li key={index} className="flex gap-2">
              <span className="w-6 shrink-0 text-right text-[#001F3F]/35 dark:text-white/30">{entry.turn}</span>
              <span
                className={`min-w-0 flex-1 truncate ${
                  entry.kind === 'refused' ? 'text-[#C2670A] dark:text-[#C87A16]' : entry.kind === 'final' ? 'font-sans text-[#001F3F]/80 dark:text-white/75' : ''
                }`}
                title={entry.summary}
              >
                {entry.summary}
              </span>
              {entry.cachedTokens !== null && entry.promptTokens ? (
                <span className="shrink-0 text-[#001F3F]/35 dark:text-white/30" title="prompt tokens the engine already had cached">
                  {Math.round((entry.cachedTokens / entry.promptTokens) * 100)}% cached
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default LivePanel;
