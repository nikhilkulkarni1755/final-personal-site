/**
 * Chart tokens for the Fireworks page.
 *
 * The two categorical hues were validated with the dataviz palette validator
 * against both surfaces before being written down here. Do not substitute
 * colours by eye — re-run the validator if these change.
 *
 *   light  (surface #FFFFFF)  #0B6FA4 / #C2670A
 *     lightness band PASS · chroma PASS · CVD ΔE 20.3 (protan) · normal ΔE 27.7 · contrast PASS
 *   dark   (surface #001F3F)  #2B8CBF / #C87A16
 *     lightness band PASS · chroma PASS · CVD ΔE 21.3 (protan) · normal ΔE 25.9 · contrast PASS
 *
 * Series colour is applied through CSS custom properties so light/dark is a
 * Tailwind variant rather than a JS media query — see SERIES_VARS.
 */

/** Put this on any wrapper that contains a chart. */
export const SERIES_VARS =
  '[--c-prefill:#0B6FA4] [--c-decode:#C2670A] [--c-neutral:#64748B] ' +
  'dark:[--c-prefill:#2B8CBF] dark:[--c-decode:#C87A16] dark:[--c-neutral:#94A3B8]';

export const SERIES = {
  prefill: 'var(--c-prefill)',
  decode: 'var(--c-decode)',
  neutral: 'var(--c-neutral)',
} as const;

/** Recessive chrome. Grid and axes must never compete with the data. */
export const GRID_CLASS = 'stroke-[#001F3F]/10 dark:stroke-white/10';
export const AXIS_TEXT_CLASS = 'fill-[#001F3F]/45 dark:fill-white/40';
export const LABEL_TEXT_CLASS = 'fill-[#001F3F]/70 dark:fill-white/65';

/** Linear scale factory. */
export const scale = (d0: number, d1: number, r0: number, r1: number) => {
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
};

/** "Nice" tick values across a domain. */
export const ticks = (min: number, max: number, count = 5): number[] => {
  const span = max - min || 1;
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 7.5 ? 10 : normalized >= 3.5 ? 5 : normalized >= 1.5 ? 2 : 1) * magnitude;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let value = start; value <= max + step * 0.001; value += step) {
    out.push(Number(value.toFixed(10)));
  }
  return out;
};

export const formatMs = (ms: number): string => {
  if (ms >= 10000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
};

export const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** Smooth path through points; falls back to a polyline for short series. */
export const linePath = (points: Array<[number, number]>): string => {
  if (points.length < 2) return '';
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
};
