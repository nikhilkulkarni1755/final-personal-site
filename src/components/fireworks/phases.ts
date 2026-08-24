/**
 * Reconstruct which phase each request was in, from its own token timings.
 *
 * The original hero chart plotted `sglang:utilization`, scraped from the engine
 * while a set ran. On the measured H100 runs that gauge reported 0.0 for every
 * sample, so the chart was empty. The captures are otherwise sound — the failure
 * is one dead series, not bad data.
 *
 * What survives is better anyway. Every request records when it was issued, how
 * long until its first token, and the gap before each token after that. From
 * those three the phase boundaries follow exactly:
 *
 *     prefill = [started_at, started_at + ttft]
 *     decode  = [started_at + ttft, started_at + ttft + sum(itl)]
 *
 * That is measured token timing rather than a sampled gauge, so it cannot drift
 * or miss a spike between polls.
 *
 * **It is not GPU utilization, and must never be labelled as such.** It counts
 * requests in a phase, which answers the narrower question the PD argument
 * actually turns on: while a long prefill was running, was anything allowed to
 * decode? A busy-ness percentage would answer a different question, and the data
 * for it does not exist in these runs.
 */

import type { CaptureRequest, CaptureRun } from './types';

export interface PhaseWindow {
  id: string;
  startMs: number;
  /** End of prefill / start of decode. */
  firstTokenMs: number;
  endMs: number;
  outputTokens: number;
  /** True when this request is the one the demo replays. */
  isEdit: boolean;
}

export interface PhaseSample {
  tMs: number;
  prefilling: number;
  decoding: number;
}

export interface PhaseTimeline {
  windows: PhaseWindow[];
  samples: PhaseSample[];
  durationMs: number;
  /** Most requests observed in either phase at once — the y-axis ceiling. */
  peakConcurrent: number;
}

const windowFor = (request: CaptureRequest): PhaseWindow => {
  const startMs = request.started_at_ms ?? 0;
  const firstTokenMs = startMs + request.ttft_ms;
  const decodeMs = request.itl_ms.reduce((sum, gap) => sum + gap, 0);
  return {
    id: request.id,
    startMs,
    firstTokenMs,
    endMs: firstTokenMs + decodeMs,
    outputTokens: request.output_tokens,
    isEdit: Boolean(request.target_file),
  };
};

/**
 * Build the timeline for a set. `steps` controls resolution only; the phase
 * boundaries themselves are exact, so sampling never loses an event — it just
 * decides how finely the step function is drawn.
 */
export const phaseTimeline = (run: CaptureRun, setName: 'set1' | 'set2' | 'set3' = 'set2', steps = 240): PhaseTimeline => {
  const requests = run.sets[setName]?.requests ?? [];
  const windows = requests.map(windowFor);

  if (!windows.length) {
    return { windows: [], samples: [], durationMs: 0, peakConcurrent: 0 };
  }

  const durationMs = Math.max(...windows.map((w) => w.endMs));
  const samples: PhaseSample[] = [];
  let peakConcurrent = 0;

  for (let index = 0; index <= steps; index += 1) {
    const tMs = (durationMs * index) / steps;
    let prefilling = 0;
    let decoding = 0;
    windows.forEach((w) => {
      if (tMs >= w.startMs && tMs < w.firstTokenMs) prefilling += 1;
      else if (tMs >= w.firstTokenMs && tMs <= w.endMs) decoding += 1;
    });
    peakConcurrent = Math.max(peakConcurrent, prefilling, decoding);
    samples.push({ tMs, prefilling, decoding });
  }

  return { windows, samples, durationMs, peakConcurrent };
};

/** How long the set spent with at least one request in each phase. */
export const phaseTotals = (timeline: PhaseTimeline) => {
  const prefillMs = timeline.windows.reduce((sum, w) => sum + (w.firstTokenMs - w.startMs), 0);
  const decodeMs = timeline.windows.reduce((sum, w) => sum + (w.endMs - w.firstTokenMs), 0);
  return { prefillMs, decodeMs };
};
