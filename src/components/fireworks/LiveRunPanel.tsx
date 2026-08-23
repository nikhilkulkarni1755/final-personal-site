import { useState } from 'react';
import { AlertTriangle, Loader2, Power, Zap } from 'lucide-react';
import type { useFireworksLive } from '../../hooks/useFireworksLive';

type Live = ReturnType<typeof useFireworksLive>;

/**
 * LiveRunPanel - offers to wake a real GPU, and is honest when it cannot.
 *
 * Everything above this on the page already works, so this panel never blocks
 * anything. Its job is to make the claim falsifiable: the same harness, run
 * against a real engine, on demand. When capacity is not there it says so and
 * the page carries on replaying — that refusal is itself part of the argument.
 */
const LiveRunPanel = ({ live }: { live: Live }) => {
  const [credential, setCredential] = useState('');

  if (!live.available) return null;

  const failed = live.state === 'failed';
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = credential.trim();
    void live.start(value.includes('@') ? { email: value } : { token: value });
  };

  return (
    <div className="rounded-xl border border-[#001F3F]/10 bg-[#001F3F]/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-2 flex items-center gap-2">
        <Zap className="h-4 w-4 text-[#001F3F]/60 dark:text-white/55" />
        <h3 className="font-semibold text-[#001F3F] dark:text-white">Run it live</h3>
      </div>

      <p className="mb-4 max-w-2xl text-sm text-[#001F3F]/65 dark:text-white/60">
        Everything above replays measurements recorded against a real engine. This wakes that engine
        again and reruns the same harness, so the numbers are checkable rather than merely claimed.
        It is gated because it spends money: two H100s, torn down automatically after ten minutes.
      </p>

      {live.state === 'ready' && (
        <div className="mb-3 rounded-lg border border-[#0F7B5A]/30 bg-[#0F7B5A]/[0.07] px-3 py-2 text-sm text-[#001F3F]/80 dark:text-white/75">
          <strong className="font-semibold">Engine is live</strong> on {live.gpu ?? 'GPU'}
          {live.costPerHour !== null && <> · ${live.costPerHour.toFixed(2)}/hr</>}
          {live.secondsRemaining !== null && (
            <> · reclaimed in {Math.floor(live.secondsRemaining / 60)}m {live.secondsRemaining % 60}s</>
          )}
        </div>
      )}

      {live.state === 'starting' && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#001F3F]/10 bg-white px-3 py-2 text-sm text-[#001F3F]/70 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{live.message || 'Allocating a pod and loading ~61GB of weights. A few minutes.'}</span>
        </div>
      )}

      {failed && (
        <div className="mb-3 flex gap-2 rounded-lg border border-[#C2670A]/40 bg-[#C2670A]/[0.07] px-3 py-2 text-sm text-[#001F3F]/80 dark:border-[#C87A16]/40 dark:bg-[#C87A16]/[0.09] dark:text-white/75">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#C2670A] dark:text-[#C87A16]" />
          <span>{live.message}</span>
        </div>
      )}

      {live.state === 'ready' || live.state === 'starting' ? (
        <button
          type="button"
          onClick={() => void live.stop()}
          disabled={live.busy}
          className="flex items-center gap-1.5 rounded-lg border border-[#001F3F]/15 px-3 py-1.5 text-sm text-[#001F3F]/75 transition-colors hover:bg-[#001F3F]/[0.05] disabled:opacity-40 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/[0.06]"
        >
          <Power className="h-3.5 w-3.5" /> Tear it down now
        </button>
      ) : (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            placeholder="you@fireworks.ai — or a shared link token"
            className="min-w-64 flex-1 rounded-lg border border-[#001F3F]/15 bg-white px-3 py-1.5 text-sm text-[#001F3F] placeholder:text-[#001F3F]/35 dark:border-white/15 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30"
          />
          <button
            type="submit"
            disabled={live.busy || !credential.trim()}
            className="rounded-lg bg-[#001F3F] px-4 py-1.5 text-sm font-semibold text-white transition-opacity disabled:opacity-40 dark:bg-white dark:text-[#001F3F]"
          >
            {live.busy ? 'Waking…' : 'Wake the GPU'}
          </button>
        </form>
      )}
    </div>
  );
};

export default LiveRunPanel;
