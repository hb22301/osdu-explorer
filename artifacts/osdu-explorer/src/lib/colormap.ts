// Sequential colormaps for elevation / continuous-property coloring.
//
// Pure module — no `three`, no DOM, no React. Safe to import from tests (tsx),
// from the mesh builder, and from the 3D view. Colors are returned as RGB in
// the 0..1 range (what three.js BufferAttribute expects); helpers are provided
// to render them as CSS `rgb()` for the legend.

export type ColormapName = "viridis" | "cividis" | "turbo";

export type RGB = [number, number, number]; // each channel 0..1

// Evenly-spaced control points across [0,1]. Sampled from the canonical
// perceptually-uniform maps; linear interpolation between stops is close enough
// for surface coloring and keeps this dependency-free. All are colorblind-safe;
// none are rainbow/jet.
const STOPS: Record<ColormapName, RGB[]> = {
  viridis: [
    [0.267, 0.005, 0.329],
    [0.283, 0.141, 0.458],
    [0.254, 0.265, 0.530],
    [0.207, 0.372, 0.553],
    [0.164, 0.471, 0.558],
    [0.128, 0.567, 0.551],
    [0.135, 0.659, 0.518],
    [0.267, 0.749, 0.441],
    [0.478, 0.821, 0.318],
    [0.741, 0.873, 0.150],
    [0.993, 0.906, 0.144],
  ],
  cividis: [
    [0.000, 0.135, 0.305],
    [0.000, 0.204, 0.404],
    [0.208, 0.277, 0.393],
    [0.333, 0.345, 0.404],
    [0.443, 0.415, 0.412],
    [0.557, 0.486, 0.400],
    [0.678, 0.561, 0.369],
    [0.804, 0.639, 0.314],
    [0.930, 0.722, 0.227],
    [0.996, 0.812, 0.153],
    [1.000, 0.914, 0.275],
  ],
  turbo: [
    [0.190, 0.072, 0.232],
    [0.246, 0.259, 0.667],
    [0.239, 0.431, 0.918],
    [0.180, 0.612, 0.945],
    [0.137, 0.769, 0.796],
    [0.216, 0.867, 0.549],
    [0.482, 0.937, 0.319],
    [0.725, 0.937, 0.208],
    [0.918, 0.802, 0.196],
    [0.980, 0.573, 0.169],
    [0.910, 0.318, 0.106],
    [0.729, 0.104, 0.024],
    [0.480, 0.016, 0.011],
  ],
};

export const COLORMAP_NAMES = Object.keys(STOPS) as ColormapName[];

// Neutral gray used for null / undefined nodes so they read as "no data"
// rather than as a value on the ramp.
export const NULL_COLOR: RGB = [0.55, 0.55, 0.58];

/** Sample a colormap at t (clamped to [0,1]) with linear interpolation. */
export function sampleColormap(name: ColormapName, t: number): RGB {
  const stops = STOPS[name] ?? STOPS.viridis;
  const x = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const n = stops.length - 1;
  const pos = x * n;
  const i = Math.min(n - 1, Math.floor(pos));
  const f = pos - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

/** CSS `rgb(...)` string for an RGB in 0..1. */
export function rgbToCss([r, g, b]: RGB): string {
  const to255 = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

/** A CSS `linear-gradient(...)` spanning a colormap, for legends/swatches. */
export function colormapGradientCss(name: ColormapName, angle = "to top"): string {
  const stops = STOPS[name] ?? STOPS.viridis;
  const n = stops.length - 1;
  const parts = stops.map((c, i) => `${rgbToCss(c)} ${((i / n) * 100).toFixed(1)}%`);
  return `linear-gradient(${angle}, ${parts.join(", ")})`;
}

/**
 * Robust color domain [vmin, vmax] from the low/high percentiles of the finite
 * values, so a few outliers don't wash out the ramp. Defaults to 2nd/98th.
 * Returns [0,1] when there are no finite values, and widens a degenerate range.
 */
export function robustDomain(
  values: ArrayLike<number>,
  loPct = 2,
  hiPct = 98,
): [number, number] {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return [0, 1];
  finite.sort((a, b) => a - b);
  const pick = (p: number) => {
    const idx = (p / 100) * (finite.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return finite[lo];
    return finite[lo] + (finite[hi] - finite[lo]) * (idx - lo);
  };
  let vmin = pick(loPct);
  let vmax = pick(hiPct);
  if (!(vmax > vmin)) {
    // Degenerate (flat surface or single value): widen so coloring is stable.
    const c = vmin;
    const eps = Math.abs(c) > 0 ? Math.abs(c) * 0.5 : 1;
    vmin = c - eps;
    vmax = c + eps;
  }
  return [vmin, vmax];
}

/**
 * Per-vertex RGB (0..1) for a scalar array. Non-finite scalars get NULL_COLOR.
 * Output length is values.length * 3, laid out [r,g,b, r,g,b, ...].
 */
export function mapScalarsToColors(
  values: ArrayLike<number>,
  domain: [number, number],
  name: ColormapName,
  nullColor: RGB = NULL_COLOR,
): Float32Array {
  const [vmin, vmax] = domain;
  const span = vmax - vmin || 1;
  const out = new Float32Array(values.length * 3);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const [r, g, b] = Number.isFinite(v)
      ? sampleColormap(name, (v - vmin) / span)
      : nullColor;
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
  return out;
}
