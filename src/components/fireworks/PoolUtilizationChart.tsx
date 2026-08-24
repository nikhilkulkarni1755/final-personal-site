import { useMemo, useRef, useState } from 'react';
import { AXIS_TEXT_CLASS, GRID_CLASS, SERIES, formatMs, scale, ticks } from './chartTokens';
import { phaseTimeline } from './phases';
import type { CaptureRun } from './types';

interface PoolUtilizationChartProps {
  run: CaptureRun;
  /**
   * Shared time domain across both modes. Without it each panel scales to its
   * own duration and the slower run looks comparable to the faster one — the
   * toggle would then compare two differently-stretched pictures rather than
   * two runs.
   */
  domainMs?: number;
}

const WIDTH = 720;
const ROW_H = 34;
const PAD = { top: 26, right: 24, bottom: 40, left: 132 };

/**
 * The hero: two requests with opposite shapes, and what each device was doing.
 *
 * Drawn from measured token timings rather than a sampled gauge — see phases.ts
 * for why, and for the limits of what this can claim. Each request is one row;
 * the bar shows prefill then decode, so "was anything able to decode while that
 * long prefill ran?" is answered by looking at whether the bars overlap.
 *
 * A Gantt rather than a utilization curve because that is what the data supports.
 * Drawing a percentage would imply a busy-ness measurement these runs do not
 * contain.
 */
const PoolUtilizationChart = ({ run, domainMs }: PoolUtilizationChartProps) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const timeline = useMemo(() => phaseTimeline(run, 'set2'), [run]);

  if (!timeline.windows.length) {
    return (
      <p className="py-12 text-center text-sm text-[#001F3F]/40 dark:text-white/40">
        This run has no Set 2 requests.
      </p>
    );
  }

  const domain = domainMs && domainMs > 0 ? domainMs : timeline.durationMs;
  const height = PAD.top + timeline.windows.length * ROW_H + PAD.bottom;
  const plotW = WIDTH - PAD.left - PAD.right;
  const x = scale(0, domain, PAD.left, PAD.left + plotW);
  const rowY = (index: number) => PAD.top + index * ROW_H + ROW_H / 2;

  const label = (id: string) =>
    id.replace(/^s2-/, '').replace('prefill-heavy', 'long prompt').replace('decode-heavy', 'long answer');

  return (
    <figure className="m-0">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        role="img"
        aria-label="When each request was prefilling and when it was decoding"
      >
        {ticks(0, domain, 6).map((value) => (
          <g key={value}>
            <line x1={x(value)} x2={x(value)} y1={PAD.top - 8} y2={height - PAD.bottom} className={GRID_CLASS} strokeWidth={1} />
            <text x={x(value)} y={height - PAD.bottom + 16} textAnchor="middle" className={`${AXIS_TEXT_CLASS} text-[10px]`}>
              {formatMs(value)}
            </text>
          </g>
        ))}

        {/* legend — two series, so direct labels rather than a box */}
        <g>
          <rect x={PAD.left} y={PAD.top - 22} width={10} height={8} rx={2} fill={SERIES.prefill} />
          <text x={PAD.left + 15} y={PAD.top - 15} className={`${AXIS_TEXT_CLASS} text-[10px]`}>reading the prompt</text>
          <rect x={PAD.left + 118} y={PAD.top - 22} width={10} height={8} rx={2} fill={SERIES.decode} />
          <text x={PAD.left + 133} y={PAD.top - 15} className={`${AXIS_TEXT_CLASS} text-[10px]`}>writing the answer</text>
        </g>

        {timeline.windows.map((w, index) => {
          const dim = hovered !== null && hovered !== w.id;
          const prefillW = Math.max(x(w.firstTokenMs) - x(w.startMs), 1);
          const decodeW = Math.max(x(w.endMs) - x(w.firstTokenMs), 1);
          return (
            <g
              key={w.id}
              onPointerEnter={() => setHovered(w.id)}
              onPointerLeave={() => setHovered(null)}
              opacity={dim ? 0.45 : 1}
            >
              <rect x={PAD.left} y={rowY(index) - ROW_H / 2} width={plotW} height={ROW_H} fill="transparent" />
              <text x={PAD.left - 12} y={rowY(index) + 4} textAnchor="end" className={`${AXIS_TEXT_CLASS} text-[11px] font-medium`}>
                {label(w.id)}
              </text>
              {/* 2px gap between the two fills so the boundary stays legible */}
              <rect x={x(w.startMs)} y={rowY(index) - 7} width={prefillW} height={14} rx={4} fill={SERIES.prefill} />
              <rect x={x(w.firstTokenMs) + 2} y={rowY(index) - 7} width={Math.max(decodeW - 2, 1)} height={14} rx={4} fill={SERIES.decode} />
              <text x={x(w.endMs) + 6} y={rowY(index) + 4} className={`${AXIS_TEXT_CLASS} text-[9px] tabular-nums`}>
                {w.outputTokens.toLocaleString()} tok
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-1 text-[11px] leading-relaxed text-[#001F3F]/55 dark:text-white/50">
        {hovered ? (
          (() => {
            const w = timeline.windows.find((item) => item.id === hovered)!;
            return (
              <span className="tabular-nums">
                {label(w.id)} · read for {formatMs(w.firstTokenMs - w.startMs)}, then wrote{' '}
                {w.outputTokens.toLocaleString()} tokens over {formatMs(w.endMs - w.firstTokenMs)}
              </span>
            );
          })()
        ) : (
          <span>
            Two requests issued together. Each bar is one request: reading its prompt, then writing its answer —
            derived from the recorded time-to-first-token and every inter-token gap, so it is measured timing rather
            than a sampled average. It shows <em>which phase each request was in</em>, not how busy the GPUs were.
            Both modes share one time axis, so the toggle compares runs rather than two differently-stretched
            pictures. This set finished in {formatMs(timeline.durationMs)}.
          </span>
        )}
      </figcaption>
    </figure>
  );
};

export default PoolUtilizationChart;
