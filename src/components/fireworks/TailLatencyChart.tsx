import { AXIS_TEXT_CLASS, GRID_CLASS, SERIES, formatMs, scale, ticks } from './chartTokens';
import type { CaptureRun } from './types';

interface TailLatencyChartProps {
  disaggregated: CaptureRun;
  colocated: CaptureRun;
}

const WIDTH = 720;
const HEIGHT = 200;
const PAD = { top: 34, right: 64, bottom: 40, left: 116 };
const PLOT_W = WIDTH - PAD.left - PAD.right;

const quantile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, sorted.length - 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

/**
 * TailLatencyChart - p50 to p99 time-to-first-token, both modes at once.
 *
 * A range plot rather than two bar charts, because the distance between p50 and
 * p99 is the interesting quantity — a tail is a relationship between two numbers,
 * and bars side by side hide it. The span makes it the shape of the mark.
 *
 * Measured, this chart does not say what it was built to say: disaggregation lost
 * both quantiles. That is the result, so it is what the caption states.
 *
 * Both modes are shown together deliberately — this is the one chart where the
 * comparison is the point, so it does not follow the page's mode toggle.
 */
const TailLatencyChart = ({ disaggregated, colocated }: TailLatencyChartProps) => {
  const rows = [
    { label: 'disaggregated', run: disaggregated, color: SERIES.prefill },
    { label: 'colocated', run: colocated, color: SERIES.decode },
  ]
    .map((row) => {
      const ttfts = (row.run.sets.set3?.requests ?? []).map((request) => request.ttft_ms);
      if (!ttfts.length) return null;
      return { ...row, p50: quantile(ttfts, 0.5), p99: quantile(ttfts, 0.99), count: ttfts.length };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length < 2) {
    return <p className="py-12 text-center text-sm text-[#001F3F]/40 dark:text-white/40">Need both modes to compare tails.</p>;
  }

  const maxValue = Math.max(...rows.map((row) => row.p99)) * 1.1;
  const x = scale(0, maxValue, PAD.left, PAD.left + PLOT_W);
  const rowY = (index: number) => PAD.top + 26 + index * 56;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="p50 to p99 time to first token by mode">
        {ticks(0, maxValue, 5).map((value) => (
          <g key={value}>
            <line x1={x(value)} x2={x(value)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className={GRID_CLASS} strokeWidth={1} />
            <text x={x(value)} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" className={`${AXIS_TEXT_CLASS} text-[10px]`}>
              {formatMs(value)}
            </text>
          </g>
        ))}

        <text x={PAD.left} y={PAD.top - 12} className={`${AXIS_TEXT_CLASS} text-[10px]`}>
          p50 ●——————● p99 · time to first token
        </text>

        {rows.map((row, index) => (
          <g key={row.label}>
            <text x={PAD.left - 12} y={rowY(index) + 4} textAnchor="end" className={`${AXIS_TEXT_CLASS} text-[11px] font-medium`}>
              {row.label}
            </text>
            {/* the span between the quantiles is the mark */}
            <line
              x1={x(row.p50)}
              x2={x(row.p99)}
              y1={rowY(index)}
              y2={rowY(index)}
              stroke={row.color}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <circle cx={x(row.p50)} cy={rowY(index)} r={5} fill={row.color} stroke="white" strokeWidth={2} />
            <circle cx={x(row.p99)} cy={rowY(index)} r={5} fill={row.color} stroke="white" strokeWidth={2} />
            {/* Labels sit outside the span rather than above the dots: when p50 and
                p99 are close together, centred labels collide. */}
            <text x={x(row.p50) - 10} y={rowY(index) + 4} textAnchor="end" className={`${AXIS_TEXT_CLASS} text-[10px] tabular-nums`}>
              {formatMs(row.p50)}
            </text>
            <text x={x(row.p99) + 10} y={rowY(index) + 4} textAnchor="start" className={`${AXIS_TEXT_CLASS} text-[10px] font-semibold tabular-nums`}>
              {formatMs(row.p99)}
            </text>
          </g>
        ))}
      </svg>

      <figcaption className="mt-1 text-[11px] text-[#001F3F]/55 dark:text-white/50">
        {rows[0].count} concurrent requests, no shared prefix — the case disaggregation exists for. It lost
        both the median and the tail. Eight requests on two H100s never generates the phase contention the split
        is meant to resolve, so it only pays the cost.
      </figcaption>
    </figure>
  );
};

export default TailLatencyChart;
