import { useState } from 'react';
import { AXIS_TEXT_CLASS, GRID_CLASS, SERIES, formatMs, scale, ticks } from './chartTokens';
import type { CaptureRun } from './types';

interface CacheCliffChartProps {
  run: CaptureRun;
}

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { top: 20, right: 20, bottom: 52, left: 56 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

/**
 * CacheCliffChart - time-to-first-token across three requests sharing one prefix.
 *
 * A linear scale is deliberate. On a log scale the three bars would look
 * comparable; linear is what makes the second and third requests almost vanish,
 * which is an honest picture of what prefix caching actually does to TTFT.
 *
 * One series, so no legend — the title names it. Three bars, so every bar can
 * carry a direct label without the chart becoming a table.
 */
const CacheCliffChart = ({ run }: CacheCliffChartProps) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const requests = run.sets.set1?.requests ?? [];

  if (!requests.length) {
    return <p className="py-12 text-center text-sm text-[#001F3F]/40 dark:text-white/40">No Set 1 data in this run.</p>;
  }

  const maxTtft = Math.max(...requests.map((request) => request.ttft_ms));
  const y = scale(0, maxTtft * 1.12, PAD.top + PLOT_H, PAD.top);
  const slot = PLOT_W / requests.length;
  const barWidth = Math.min(96, slot * 0.5);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Time to first token per request">
        {ticks(0, maxTtft * 1.12, 4).map((value) => (
          <g key={value}>
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(value)} y2={y(value)} className={GRID_CLASS} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(value) + 3.5} textAnchor="end" className={`${AXIS_TEXT_CLASS} text-[10px]`}>
              {formatMs(value)}
            </text>
          </g>
        ))}

        {requests.map((request, index) => {
          const cached = (request.cache_hit_tokens ?? 0) > 0;
          const cx = PAD.left + slot * index + slot / 2;
          const top = y(request.ttft_ms);
          const height = PAD.top + PLOT_H - top;
          const isHovered = hovered === index;
          return (
            <g
              key={request.id}
              onPointerEnter={() => setHovered(index)}
              onPointerLeave={() => setHovered(null)}
            >
              {/* generous hit target, larger than the mark */}
              <rect x={cx - slot / 2} y={PAD.top} width={slot} height={PLOT_H} fill="transparent" />
              <rect
                x={cx - barWidth / 2}
                y={top}
                width={barWidth}
                height={Math.max(height, 2)}
                rx={4}
                fill={cached ? SERIES.decode : SERIES.prefill}
                opacity={hovered === null || isHovered ? 1 : 0.55}
              />
              <text x={cx} y={top - 8} textAnchor="middle" className={`${AXIS_TEXT_CLASS} text-[11px] font-semibold tabular-nums`}>
                {formatMs(request.ttft_ms)}
              </text>
              <text x={cx} y={PAD.top + PLOT_H + 18} textAnchor="middle" className={`${AXIS_TEXT_CLASS} text-[10px]`}>
                request {index + 1}
              </text>
              <text x={cx} y={PAD.top + PLOT_H + 32} textAnchor="middle" className={`${AXIS_TEXT_CLASS} text-[9px]`}>
                {cached ? `${(request.cache_hit_tokens ?? 0).toLocaleString()} tokens cached` : 'full prefill'}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-1 text-[11px] text-[#001F3F]/55 dark:text-white/50">
        {hovered !== null ? (
          <span className="tabular-nums">
            “{requests[hovered].prompt}” · {requests[hovered].prompt_tokens.toLocaleString()} prompt tokens ·{' '}
            {requests[hovered].output_tokens.toLocaleString()} generated
          </span>
        ) : (
          <span>
            Same project, three different questions. The first pays for the whole prefix; the rest reuse it.
          </span>
        )}
      </figcaption>
    </figure>
  );
};

export default CacheCliffChart;
