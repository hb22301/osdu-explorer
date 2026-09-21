// Geometry builder for a RESQML Grid2dRepresentation ("SurfaceGrid").
//
// Pure module — no `three` import — so it can be unit-tested with tsx and so the
// toolbar can import the Grid2dSurface type without pulling in the 3D stack.
// The 3D view turns these plain typed arrays into a THREE.BufferGeometry.
//
// Node ordering is row-major with the FastestAxis = I: node (i, j) lives at
// index `j * ni + i`. Undefined nodes are carried as NaN in `z` and become
// holes in the mesh (no triangle references them).

export interface Grid2dSurface {
  /** FastestAxisCount (number of nodes along I). */
  ni: number;
  /** SlowestAxisCount (number of nodes along J). */
  nj: number;
  /** Elevation per node, length ni*nj, index = j*ni + i. NaN = null/undefined. */
  z: Float32Array;
  /** Lattice origin (x,y,z) if the SupportingGeometry was resolved. */
  origin?: [number, number, number];
  /** World-space step per +1 in I (direction * spacing). */
  iStep?: [number, number, number];
  /** World-space step per +1 in J (direction * spacing). */
  jStep?: [number, number, number];
  /** Record Citation.Title, shown in the view header/legend. */
  title: string;
  /** CRS length unit (e.g. "m", "ft") if known. */
  units?: string;
  /** RESQML CRS ZIncreasingDownward flag; when true Z is negated for display. */
  zIncreasingDownward?: boolean;
}

export interface Grid2dMesh {
  /** Vertex positions, length ni*nj*3. Null nodes are placed at the finite z-min. */
  positions: Float32Array;
  /** Triangle indices; triangles touching a null node are omitted. */
  indices: Uint32Array;
  /** Count of finite (rendered) nodes. */
  validCount: number;
  /** Count of null/undefined nodes. */
  nullCount: number;
  /** Whether XY came from the lattice ("lattice") or index space ("index"). */
  xySource: "lattice" | "index";
  /** Finite elevation range (raw, before any downward flip). */
  zMin: number;
  zMax: number;
  /** Axis-aligned bounds of the rendered positions. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

/** True when this surface has a resolvable XY lattice (vs. index-space fallback). */
export function hasLattice(s: Grid2dSurface): boolean {
  return Array.isArray(s.origin) && Array.isArray(s.iStep) && Array.isArray(s.jStep);
}

/** Finite min/max of an elevation array; returns [0,0] if none are finite. */
export function finiteZRange(z: ArrayLike<number>): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < z.length; i++) {
    const v = z[i];
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return [0, 0];
  return [min, max];
}

/**
 * Build vertex positions + triangle indices for a Grid2dSurface.
 *
 * @param zScale Vertical exaggeration applied to the (display) elevation only.
 */
export function buildGrid2dMesh(surface: Grid2dSurface, zScale = 1): Grid2dMesh {
  const { ni, nj, z } = surface;
  const expected = ni * nj;
  if (!Number.isInteger(ni) || !Number.isInteger(nj) || ni < 2 || nj < 2) {
    throw new Error(`Grid2d dimensions invalid: ni=${ni}, nj=${nj}`);
  }
  if (z.length !== expected) {
    throw new Error(`Grid2d z length ${z.length} != ni*nj (${expected})`);
  }

  const useLattice = hasLattice(surface);
  const origin = surface.origin ?? [0, 0, 0];
  const iStep = surface.iStep ?? [1, 0, 0];
  const jStep = surface.jStep ?? [0, 1, 0];
  const flip = surface.zIncreasingDownward ? -1 : 1;

  const [zMin, zMax] = finiteZRange(z);
  const fillZ = zMin * flip * zScale;

  const positions = new Float32Array(expected * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let validCount = 0;
  let nullCount = 0;

  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const idx = j * ni + i;
      const raw = z[idx];
      const isNull = !Number.isFinite(raw);
      if (isNull) nullCount++;
      else validCount++;

      let x: number;
      let y: number;
      if (useLattice) {
        x = origin[0] + i * iStep[0] + j * jStep[0];
        y = origin[1] + i * iStep[1] + j * jStep[1];
      } else {
        x = i;
        y = j;
      }
      const zz = isNull ? fillZ : raw * flip * zScale;

      const o = idx * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = zz;

      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (zz < min[2]) min[2] = zz;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (zz > max[2]) max[2] = zz;
    }
  }

  const idxArr: number[] = [];
  for (let j = 0; j < nj - 1; j++) {
    for (let i = 0; i < ni - 1; i++) {
      const a = j * ni + i;
      const b = j * ni + (i + 1);
      const c = (j + 1) * ni + (i + 1);
      const d = (j + 1) * ni + i;
      if (
        !Number.isFinite(z[a]) ||
        !Number.isFinite(z[b]) ||
        !Number.isFinite(z[c]) ||
        !Number.isFinite(z[d])
      ) {
        continue;
      }
      idxArr.push(a, b, d, b, c, d);
    }
  }

  return {
    positions,
    indices: Uint32Array.from(idxArr),
    validCount,
    nullCount,
    xySource: useLattice ? "lattice" : "index",
    zMin,
    zMax,
    bounds: { min, max },
  };
}

export interface Grid2dGridLines {
  /** XYZ triples; each consecutive pair of vertices is one segment (LineSegments). */
  positions: Float32Array;
  /** Display position of the lattice origin node (i=0, j=0). */
  origin: [number, number, number];
  /** Display position of the far end of the I edge from the origin (node ni-1, j=0). */
  iAxisEnd: [number, number, number];
  /** Display position of the far end of the J edge from the origin (node i=0, nj-1). */
  jAxisEnd: [number, number, number];
}

/**
 * Build the full I/J lattice as line segments plus the origin/axis reference
 * points, reusing the vertex positions produced by {@link buildGrid2dMesh} so
 * the grid sits on the surface. Every row/column segment is drawn, including
 * those over null nodes, so the grid spans the complete extent out to the axes
 * and null cells stand out as empty framed cells with no surface behind them.
 *
 * @param positions The `positions` array from `buildGrid2dMesh(surface, zScale)`.
 */
export function buildGrid2dGridLines(
  surface: Grid2dSurface,
  positions: Float32Array,
): Grid2dGridLines {
  const { ni, nj } = surface;
  const expected = ni * nj;
  if (positions.length !== expected * 3) {
    throw new Error(`Grid2d positions length ${positions.length} != ni*nj*3 (${expected * 3})`);
  }

  const node = (i: number, j: number) => (j * ni + i) * 3;
  const at = (i: number, j: number): [number, number, number] => {
    const o = node(i, j);
    return [positions[o], positions[o + 1], positions[o + 2]];
  };

  const seg: number[] = [];
  const pushSeg = (a: number, b: number) => {
    seg.push(
      positions[a], positions[a + 1], positions[a + 2],
      positions[b], positions[b + 1], positions[b + 2],
    );
  };

  // I-lines (rows): connect neighbours along +I for every j.
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni - 1; i++) {
      pushSeg(node(i, j), node(i + 1, j));
    }
  }
  // J-lines (columns): connect neighbours along +J for every i.
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj - 1; j++) {
      pushSeg(node(i, j), node(i, j + 1));
    }
  }

  return {
    positions: Float32Array.from(seg),
    origin: at(0, 0),
    iAxisEnd: at(ni - 1, 0),
    jAxisEnd: at(0, nj - 1),
  };
}

export interface Grid2dAxisTick {
  /** The underlying axis value the label reports (world X/Y, or raw elevation). */
  value: number;
  /** Display-space anchor of the tick on the bounding-box edge. */
  position: [number, number, number];
  /** Formatted, human-readable label text. */
  label: string;
}

export interface Grid2dAxisAnnotations {
  x: Grid2dAxisTick[];
  y: Grid2dAxisTick[];
  z: Grid2dAxisTick[];
  /** Shared min corner of the bounding box; the three axis lines start here. */
  origin: [number, number, number];
  xAxisEnd: [number, number, number];
  yAxisEnd: [number, number, number];
  zAxisEnd: [number, number, number];
}

/** A "nice" tick step (1/2/5 * 10^n) that yields at most ~maxCount intervals. */
function niceStep(range: number, maxCount: number): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const rough = range / Math.max(maxCount, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

/** Evenly-spaced "nice" tick values covering [min, max]; skips values between them. */
function niceTicksInRange(min: number, max: number, maxCount: number): { values: number[]; step: number } {
  const step = niceStep(max - min, maxCount);
  if (!(max > min)) return { values: [min], step };
  const start = Math.ceil(min / step - 1e-9) * step;
  const values: number[] = [];
  for (let value = start; value <= max + step * 1e-6; value += step) {
    // Snap away tiny floating-point drift so labels read cleanly (e.g. 0.30000004).
    values.push(Number(value.toFixed(10)));
  }
  return { values, step };
}

/** Format a tick value with a decimal count implied by the step and thousands grouping. */
function formatAxisValue(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Build numeric tick annotations for the X, Y and Z coordinate axes, laid along
 * three edges of the mesh bounding box. X/Y report world coordinates; Z reports
 * the raw elevation (positioned at its display height, so it tracks the vertical
 * exaggeration and any ZIncreasingDownward flip). Tick spacing is chosen to keep
 * at most ~maxTicksPerAxis labels per axis, skipping intermediate values so the
 * axes stay readable.
 */
export function buildGrid2dAxisAnnotations(
  mesh: Grid2dMesh,
  surface: Grid2dSurface,
  zScale = 1,
  maxTicksPerAxis = 6,
): Grid2dAxisAnnotations {
  const { min, max } = mesh.bounds;
  const flip = surface.zIncreasingDownward ? -1 : 1;

  const xTicks = niceTicksInRange(min[0], max[0], maxTicksPerAxis);
  const yTicks = niceTicksInRange(min[1], max[1], maxTicksPerAxis);
  const zTicks = niceTicksInRange(mesh.zMin, mesh.zMax, maxTicksPerAxis);

  const x = xTicks.values.map<Grid2dAxisTick>((value) => ({
    value,
    position: [value, min[1], min[2]],
    label: formatAxisValue(value, xTicks.step),
  }));
  const y = yTicks.values.map<Grid2dAxisTick>((value) => ({
    value,
    position: [min[0], value, min[2]],
    label: formatAxisValue(value, yTicks.step),
  }));
  const z = zTicks.values.map<Grid2dAxisTick>((value) => ({
    value,
    position: [min[0], min[1], value * flip * zScale],
    label: formatAxisValue(value, zTicks.step),
  }));

  return {
    x,
    y,
    z,
    origin: [min[0], min[1], min[2]],
    xAxisEnd: [max[0], min[1], min[2]],
    yAxisEnd: [min[0], max[1], min[2]],
    zAxisEnd: [min[0], min[1], max[2]],
  };
}

export interface Grid2dLocalTick {
  /** Grid index the label reports (I column 0..ni-1, or J row 0..nj-1). */
  index: number;
  /** Display position of the labelled node (on the i=0 or j=0 edge). */
  position: [number, number, number];
  /** The index rendered as text. */
  label: string;
}

export interface Grid2dLocalAnnotations {
  /** Ticks along the I edge (row j=0), labelled with the column index. */
  i: Grid2dLocalTick[];
  /** Ticks along the J edge (column i=0), labelled with the row index. */
  j: Grid2dLocalTick[];
  /** Display position of the lattice origin node (i=0, j=0). */
  origin: [number, number, number];
  iAxisEnd: [number, number, number];
  jAxisEnd: [number, number, number];
}

/** Indices 0..n-1 thinned to at most ~maxCount labels, always keeping the ends. */
function pickIndices(n: number, maxCount: number): number[] {
  const step = Math.max(1, Math.ceil((n - 1) / Math.max(maxCount, 1)));
  const indices: number[] = [];
  for (let value = 0; value < n - 1; value += step) indices.push(value);
  indices.push(n - 1);
  return indices;
}

/**
 * Build local grid-index (I/J) tick annotations along the two lattice edges that
 * meet at the origin node (i=0, j=0), reusing the vertex positions from
 * {@link buildGrid2dMesh} so labels sit on the surface. Indices are thinned to at
 * most ~maxTicksPerAxis per edge so the labels stay readable.
 *
 * @param positions The `positions` array from `buildGrid2dMesh(surface, zScale)`.
 */
export function buildGrid2dLocalAnnotations(
  surface: Grid2dSurface,
  positions: Float32Array,
  maxTicksPerAxis = 6,
): Grid2dLocalAnnotations {
  const { ni, nj } = surface;
  const expected = ni * nj;
  if (positions.length !== expected * 3) {
    throw new Error(`Grid2d positions length ${positions.length} != ni*nj*3 (${expected * 3})`);
  }

  const at = (i: number, j: number): [number, number, number] => {
    const o = (j * ni + i) * 3;
    return [positions[o], positions[o + 1], positions[o + 2]];
  };

  const i = pickIndices(ni, maxTicksPerAxis).map<Grid2dLocalTick>((index) => ({
    index,
    position: at(index, 0),
    label: String(index),
  }));
  const j = pickIndices(nj, maxTicksPerAxis).map<Grid2dLocalTick>((index) => ({
    index,
    position: at(0, index),
    label: String(index),
  }));

  return {
    i,
    j,
    origin: at(0, 0),
    iAxisEnd: at(ni - 1, 0),
    jAxisEnd: at(0, nj - 1),
  };
}