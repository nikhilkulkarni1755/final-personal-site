import { useState } from 'react';
import { AlertTriangle, ChevronDown, Cpu } from 'lucide-react';
import type { CaptureRun } from './types';

/**
 * RunBadge - provenance for every number on the page.
 *
 * Two jobs. First, it makes a synthetic run impossible to mistake for a
 * measurement: placeholder data gets a warning banner, not a quiet footnote.
 * Second, it exposes the exact argv each worker was launched with, so a reader
 * who doubts a number can go and reproduce it.
 */
const RunBadge = ({ run }: { run: CaptureRun }) => {
  const [open, setOpen] = useState(false);
  const synthetic = run.source === 'synthetic';

  return (
    <div
      className={`rounded-lg border text-[12px] ${
        synthetic
          ? 'border-[#C2670A]/40 bg-[#C2670A]/[0.06] dark:border-[#C87A16]/40 dark:bg-[#C87A16]/[0.08]'
          : 'border-[#001F3F]/10 bg-[#001F3F]/[0.02] dark:border-white/10 dark:bg-white/[0.03]'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {synthetic ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-[#C2670A] dark:text-[#C87A16]" />
        ) : (
          <Cpu className="h-4 w-4 shrink-0 text-[#001F3F]/50 dark:text-white/50" />
        )}
        <span className="font-semibold text-[#001F3F] dark:text-white">
          {synthetic ? 'Placeholder data — not a measurement' : 'Measured'}
        </span>
        <span className="truncate text-[#001F3F]/55 dark:text-white/50">
          {run.rig.label} · {run.rig.gpus}× {run.rig.gpu_model} · {run.model.id.split('/').pop()} · {run.mode}
        </span>
        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-[#001F3F]/10 px-3 py-3 dark:border-white/10">
          {run.notes && <p className="text-[#001F3F]/65 dark:text-white/60">{run.notes}</p>}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {[
              ['run_id', run.run_id],
              ['captured', new Date(run.timestamp).toISOString().slice(0, 16).replace('T', ' ')],
              ['engine', `${run.engine.name} ${run.engine.version}`],
              ['model', run.model.id],
              ['dtype', run.model.dtype],
              ['interconnect', run.rig.interconnect ?? '—'],
              ['kv transfer', run.engine.kv_transfer_backend ?? 'n/a (colocated)'],
              ['prefix', `${run.prefix.approx_tokens.toLocaleString()} tokens · ${run.prefix.sha256.slice(0, 12)}`],
              ['cost', run.rig.usd_per_hour ? `$${run.rig.usd_per_hour.toFixed(2)}/hr` : '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] uppercase tracking-wide text-[#001F3F]/40 dark:text-white/35">{label}</dt>
                <dd className="truncate font-mono text-[11px] text-[#001F3F]/80 dark:text-white/75">{value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-[#001F3F]/40 dark:text-white/35">
              launched with
            </p>
            <div className="space-y-1">
              {Object.entries(run.flags_used).map(([process, argv]) => (
                <pre
                  key={process}
                  className="overflow-x-auto rounded bg-[#001F3F]/[0.05] p-2 font-mono text-[10px] leading-relaxed text-[#001F3F]/75 dark:bg-black/30 dark:text-white/70"
                >
                  <span className="text-[#001F3F]/40 dark:text-white/40">{process}$ </span>
                  {argv.join(' ')}
                </pre>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RunBadge;
