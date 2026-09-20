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
  // Fallback z (display space) for null nodes — kept inside the finite range so
  // they don't distort the camera-framing bounds. They are never rendered.
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
      let zz: number;
      if (useLattice) {
        x = origin[0] + i * iStep[0] + j * jStep[0];
        y = origin[1] + i * iStep[1] + j * jStep[1];
      } else {
        x = i;
        y = j;
      }
      zz = isNull ? fillZ : raw * flip * zScale;

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

  // Two triangles per cell, skipping any cell touching a null corner.
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
      // CCW winding when viewed from +Z.
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
