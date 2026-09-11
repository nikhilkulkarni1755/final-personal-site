import { Download } from 'lucide-react';
import { formatMs } from './chartTokens';
import type { RunRow } from '../../hooks/useFireworksRuns';

/**
 * RunsTable - every run anyone has made, as a dataset.
 *
 * Appends, never edits: the gateway writes a row per run and the page reads
 * them back. Cold runs carry the boot in their time to first token, which is
 * the honest number for what that visitor waited; the engine's own boot timer
 * sits beside it so the two can be told apart. Hovering the prompt shows all
 * of it. The CSV is the same rows, for anyone who wants to look harder.
 */

const COLUMNS = [
  ['when', 'UTC'],
  ['prompt', 'hover for the whole input'],
  ['turns', 'model turns in the run: tool calls plus the final answer'],
  ['TTFT', 'time to first token on turn one, from send; a cold run carries the boot here'],
  ['engine boot', "SGLang's own startup timer when the run had to wake it; blank when warm"],
  ['turn latency', 'mean time to first token on turns two onward: what a warm turn costs'],
  ['TPOT', 'time per output token, averaged over the run (also called inter-token latency)'],
  ['cached', 'share of prompt tokens the engine already held, summed over turns'],
  ['end to end', 'first send to final word'],
  ['result', 'applied, out of scope, no change, or how it failed'],
] as const;

const pct = (part: number | null, whole: number | null) => (part !== null && whole ? `${Math.round((part / whole) * 100)}%` : '');

const resultOf = (row: RunRow) => {
  if (row.outcome !== 'ok') return row.outcome.replace('_', ' ');
  if (row.contract_outcome === 'applied') return `applied: ${(row.paths ?? []).map((p) => p.split('/').pop()).join(', ')}`;
  return (row.contract_outcome ?? 'ran').replace('_', ' ');
};

const toCsv = (rows: RunRow[]) => {
  const fields: Array<keyof RunRow> = ['created_at', 'prompt', 'model', 'outcome', 'contract_outcome', 'turns', 'wake_ms', 'ttft_ms', 'engine_boot_s', 'mean_turn_ttft_ms', 'mean_tpot_ms', 'prompt_tokens', 'cached_tokens', 'output_tokens', 'e2e_ms'];
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [fields.join(','), ...rows.map((row) => fields.map((field) => cell(row[field])).join(','))].join('\n');
};

const RunsTable = ({ rows }: { rows: RunRow[] }) => {
  if (!rows.length) {
    return <p className="py-8 text-center text-sm text-[#001F3F]/40 dark:text-white/40">No runs yet. The first one appears here as soon as it finishes.</p>;
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'inference-end-to-end-runs.csv' });
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] text-[#001F3F]/55 dark:text-white/50">
        <span>
          {rows.length.toLocaleString()} run{rows.length === 1 ? '' : 's'}, newest first. Every number is what the gateway measured for that run.
        </span>
        <button type="button" onClick={download} className="flex items-center gap-1 underline-offset-2 hover:underline">
          <Download className="h-3 w-3" /> CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px] tabular-nums">
          <thead>
            <tr className="border-b border-[#001F3F]/10 text-left text-[10px] uppercase tracking-wide text-[#001F3F]/40 dark:border-white/10 dark:text-white/35">
              {COLUMNS.map(([label, help]) => (
                <th key={label} title={help} className="whitespace-nowrap px-2 py-1.5 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-[#001F3F]/75 dark:text-white/70">
            {rows.map((row) => {
              const cold = (row.ttft_ms ?? 0) > 5000;
              return (
                <tr key={row.id} className="group border-b border-[#001F3F]/[0.06] align-top hover:bg-[#001F3F]/[0.03] dark:border-white/[0.06] dark:hover:bg-white/[0.04]">
                  <td className="whitespace-nowrap px-2 py-1.5 text-[#001F3F]/50 dark:text-white/45">{row.created_at.slice(5, 16).replace('T', ' ')}</td>
                  <td className="max-w-[16rem] px-2 py-1.5 font-sans">
                    {/* Truncated at rest; the whole input on hover, and the row grows to fit it. */}
                    <span className="block truncate group-hover:hidden">{row.prompt}</span>
                    <span className="hidden whitespace-pre-wrap break-words group-hover:block">{row.prompt}</span>
                  </td>
                  <td className="px-2 py-1.5">{row.turns}</td>
                  <td className="whitespace-nowrap px-2 py-1.5" title={cold ? 'cold: this run woke the GPU' : 'warm'}>
                    {row.ttft_ms !== null ? formatMs(row.ttft_ms) : ''}
                    {cold && <span className="ml-1 text-[9px] uppercase text-[#C2670A] dark:text-[#C87A16]">cold</span>}
                  </td>
                  <td className="px-2 py-1.5">{row.engine_boot_s !== null ? `${row.engine_boot_s.toFixed(0)}s` : ''}</td>
                  <td className="px-2 py-1.5">{row.mean_turn_ttft_ms !== null ? formatMs(row.mean_turn_ttft_ms) : ''}</td>
                  <td className="px-2 py-1.5">{row.mean_tpot_ms !== null ? `${row.mean_tpot_ms.toFixed(1)}ms` : ''}</td>
                  <td className="px-2 py-1.5">{pct(row.cached_tokens, row.prompt_tokens)}</td>
                  <td className="px-2 py-1.5">{row.e2e_ms !== null ? formatMs(row.e2e_ms) : ''}</td>
                  <td className="max-w-[12rem] truncate px-2 py-1.5 font-sans" title={resultOf(row)}>
                    {resultOf(row)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RunsTable;
