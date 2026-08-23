import { useMemo, useRef, useState } from 'react';
import {
  AXIS_TEXT_CLASS,
  GRID_CLASS,
  SERIES,
  formatMs,
  linePath,
  percent,
  scale,
  ticks,
} from './chartTokens';
import type { CaptureRun } from './types';

interface PoolUtilizationChartProps {
  run: CaptureRun;
}

const WIDTH = 720;
const HEIGHT = 300;
const PAD = { top: 18, right: 92, bottom: 34, left: 44 };

const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

/**
 * How much of the response to plot.
 *
 * All of the contention happens while the long prefill is in flight (~2.6s).
 * Stretched across a thirty-second decode it collapses into an unreadable sliver
 * against a wall of flat line. This is a fixed constant rather than a fraction of
 * the run so that the axis does not move when the mode toggle switches — two
 * charts drawn on different x-scales are not a comparison. The caption always
 * states the full duration so nothing is hidden by the crop.
 */
const WINDOW_MS = 8000;

/**
 * PoolUtilizationChart - the hero.
 *
 * One timeline, two series: how busy the prefill pool is and how busy the decode
 * pool is, while a long prefill and a long decode are in flight together.
 *
 * Disaggregated, the two curves rise together — they are on different devices,
 * so neither waits for the other. Colocated, decode flatlines at the bottom until
 * the prefill finishes, because the same GPUs cannot do both. The gap between
 * those two pictures is the entire argument for splitting the pools, and it is
 * legible without reading a single number.
 */
const PoolUtilizationChart = ({ run }: PoolUtilizationChartProps) => {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const samples = useMemo(() => {
    const request = run.sets.set2?.requests.find((item) => item.pool_util_samples?.length);
    return request?.pool_util_samples ?? [];
  }, [run]);

  const prefillEndMs = useMemo(() => {
    const heavy = run.sets.set2?.requests.find((item) => item.id === 's2-prefill-heavy');
    return heavy ? heavy.ttft_ms : null;
  }, [run]);

  if (!samples.length) {
    return (
      <p className="py-12 text-center text-sm text-[#001F3F]/40 dark:text-white/40">
        This run has no pool utilization samples.
      </p>
    );
  }

  const fullDurationMs = samples[samples.length - 1].t_ms;
  const windowMs = Math.min(WINDOW_MS, fullDurationMs);
  const visible = samples.filter((sample) => sample.t_ms <= windowMs);

  const x = scale(0, windowMs, PAD.left, PAD.left + PLOT_W);
  const y = scale(0, 1, PAD.top + PLOT_H, PAD.top);

  const prefillPoints = visible.map((s) => [x(s.t_ms), y(s.prefill_util ?? 0)] as [number, number]);
  const decodePoints = visible.map((s) => [x(s.t_ms), y(s.decode_util ?? 0)] as [number, number]);

  const hovered = hoverX === null
    ? null
    : visible.reduce((best, sample) =>
        Math.abs(x(sample.t_ms) - hoverX) < Math.abs(x(best.t_ms) - hoverX) ? sample : best,
      );

  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const position = ((event.clientX - rect.left) / rect.width) * WIDTH;
    setHoverX(position < PAD.left || position > PAD.left + PLOT_W ? null : position);
  };

  const last = visible[visible.length - 1];

  return (
    <figure className="m-0">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none"
        role="img"
        aria-label="Prefill and decode pool utilization over time"
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverX(null)}
      >
        {/* grid + y axis */}
        {ticks(0, 1, 4).map((value) => (
          <g key={value}>
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(value)} y2={y(value)} className={GRID_CLASS} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(value) + 3.5} textAnchor="end" className={`${AXIS_TEXT_CLASS} text-[10px]`}>
              {percent(value)}
            </text>
          </g>
        ))}

        {/* x axis */}
        {ticks(0, windowMs, 5).map((value) => (
          <text
            key={value}
            x={x(value)}
            y={PAD.top + PLOT_H + 18}
            textAnchor="middle"
            className={`${AXIS_TEXT_CLASS} text-[10px]`}
          >
            {formatMs(value)}
          </text>
        ))}

        {/* the prefill window, annotated once rather than labelled on every point */}
        {prefillEndMs !== null && (
          <>
            <rect
              x={PAD.left}
              y={PAD.top}
              width={Math.max(0, x(prefillEndMs) - PAD.left)}
              height={PLOT_H}
              fill="currentColor"
              className="text-[#001F3F]/[0.04] dark:text-white/[0.05]"
            />
            <line
              x1={x(prefillEndMs)}
              x2={x(prefillEndMs)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              className={GRID_CLASS}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={x(prefillEndMs) + 6}
              y={PAD.top + 12}
              className={`${AXIS_TEXT_CLASS} text-[9px]`}
            >
              ← long prefill in flight
            </text>
          </>
        )}

        {/* series */}
        <path d={linePath(prefillPoints)} fill="none" stroke={SERIES.prefill} strokeWidth={2} strokeLinejoin="round" />
        <path d={linePath(decodePoints)} fill="none" stroke={SERIES.decode} strokeWidth={2} strokeLinejoin="round" />

        {/* direct labels at the series ends — no legend box needed at n=2 */}
        <text x={PAD.left + PLOT_W + 8} y={y(last.prefill_util ?? 0) + 3.5} fill={SERIES.prefill} className="text-[10px] font-medium">
          prefill pool
        </text>
        <text x={PAD.left + PLOT_W + 8} y={y(last.decode_util ?? 0) + 3.5} fill={SERIES.decode} className="text-[10px] font-medium">
          decode pool
        </text>

        {/* crosshair */}
        {hovered && (
          <g>
            <line
              x1={x(hovered.t_ms)}
              x2={x(hovered.t_ms)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              className={GRID_CLASS}
              strokeWidth={1}
            />
            <circle cx={x(hovered.t_ms)} cy={y(hovered.prefill_util ?? 0)} r={4} fill={SERIES.prefill} stroke="white" strokeWidth={2} />
            <circle cx={x(hovered.t_ms)} cy={y(hovered.decode_util ?? 0)} r={4} fill={SERIES.decode} stroke="white" strokeWidth={2} />
          </g>
        )}
      </svg>

      <figcaption className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[11px] text-[#001F3F]/55 dark:text-white/50">
        {hovered ? (
          <>
            <span className="tabular-nums">{formatMs(hovered.t_ms)}</span>
            <span className="tabular-nums" style={{ color: SERIES.prefill }}>
              prefill {percent(hovered.prefill_util ?? 0)}
            </span>
            <span className="tabular-nums" style={{ color: SERIES.decode }}>
              decode {percent(hovered.decode_util ?? 0)}
            </span>
            <span className="tabular-nums">queue {hovered.queue_depth ?? 0}</span>
          </>
        ) : (
          <span>
            {run.mode === 'disaggregated'
              ? 'Both pools run at once — different devices, so neither waits for the other.'
              : 'Decode is pinned near zero until the prefill releases the device. Same silicon, so it waits.'}
            {' '}First {formatMs(windowMs)} of a {formatMs(fullDurationMs)} response.
          </span>
        )}
      </figcaption>
    </figure>
  );
};

export default PoolUtilizationChart;
