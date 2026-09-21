import assert from "node:assert/strict";
import {
  buildGrid2dMesh,
  buildGrid2dGridLines,
  buildGrid2dAxisAnnotations,
  buildGrid2dLocalAnnotations,
  finiteZRange,
  type Grid2dSurface,
} from "./grid2d-mesh";
import {
  robustDomain,
  mapScalarsToColors,
  sampleColormap,
  NULL_COLOR,
} from "./colormap";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const NI = 5;
const NJ = 4;
function makeSurface(nullIndex = -1): Grid2dSurface {
  const z = new Float32Array(NI * NJ);
  for (let i = 0; i < z.length; i++) z[i] = i;
  if (nullIndex >= 0) z[nullIndex] = NaN;
  return {
    ni: NI,
    nj: NJ,
    z,
    origin: [100, 200, 0],
    iStep: [10, 0, 0],
    jStep: [0, 20, 0],
    title: "Test Surface",
    units: "m",
  };
}

test("mesh has ni*nj vertices", () => {
  const mesh = buildGrid2dMesh(makeSurface());
  assert.equal(mesh.positions.length, NI * NJ * 3);
  assert.equal(mesh.validCount, NI * NJ);
  assert.equal(mesh.nullCount, 0);
});

test("full grid emits 2 triangles per cell", () => {
  const mesh = buildGrid2dMesh(makeSurface());
  const cells = (NI - 1) * (NJ - 1);
  assert.equal(mesh.indices.length, cells * 6);
});

test("node (i,j) maps to index j*ni+i with lattice XY", () => {
  const mesh = buildGrid2dMesh(makeSurface());
  const idx = 1 * NI + 2;
  const o = idx * 3;
  assert.equal(mesh.positions[o], 120);
  assert.equal(mesh.positions[o + 1], 220);
  assert.equal(mesh.positions[o + 2], 7);
});

test("a null node punches a hole", () => {
  const nullIdx = 1 * NI + 2;
  const mesh = buildGrid2dMesh(makeSurface(nullIdx));
  assert.equal(mesh.nullCount, 1);
  const fullTris = (NI - 1) * (NJ - 1) * 2;
  assert.equal(mesh.indices.length, (fullTris - 8) * 3);
  for (const v of mesh.indices) assert.notEqual(v, nullIdx);
});

test("index-space fallback when no lattice", () => {
  const s = makeSurface();
  delete s.origin;
  delete s.iStep;
  delete s.jStep;
  const mesh = buildGrid2dMesh(s);
  assert.equal(mesh.xySource, "index");
  const idx = 1 * NI + 2;
  assert.equal(mesh.positions[idx * 3], 2);
  assert.equal(mesh.positions[idx * 3 + 1], 1);
});

test("zIncreasingDownward negates display z", () => {
  const s = makeSurface();
  s.zIncreasingDownward = true;
  const mesh = buildGrid2dMesh(s);
  const idx = 1 * NI + 2;
  assert.equal(mesh.positions[idx * 3 + 2], -7);
});

test("vertical exaggeration scales z only", () => {
  const mesh = buildGrid2dMesh(makeSurface(), 3);
  const idx = 1 * NI + 2;
  assert.equal(mesh.positions[idx * 3 + 2], 21);
  assert.equal(mesh.positions[idx * 3], 120);
});

test("finiteZRange ignores NaN", () => {
  const z = new Float32Array([1, NaN, 5, 3]);
  assert.deepEqual(finiteZRange(z), [1, 5]);
});

test("robustDomain clamps to percentiles", () => {
  const vals = Array.from({ length: 100 }, (_, i) => i);
  const [lo, hi] = robustDomain(vals, 2, 98);
  assert.ok(lo > 0 && lo < 5, `lo=${lo}`);
  assert.ok(hi > 95 && hi < 99, `hi=${hi}`);
});

test("robustDomain widens a degenerate range", () => {
  const [lo, hi] = robustDomain([5, 5, 5, 5]);
  assert.ok(hi > lo, `expected widened range, got [${lo}, ${hi}]`);
});

test("mapScalarsToColors: min->first stop, null->NULL_COLOR", () => {
  const z = new Float32Array([0, 50, 100, NaN]);
  const colors = mapScalarsToColors(z, [0, 100], "viridis");
  assert.equal(colors.length, 4 * 3);
  const first = sampleColormap("viridis", 0);
  assert.ok(Math.abs(colors[0] - first[0]) < 1e-6);
  assert.ok(Math.abs(colors[9] - NULL_COLOR[0]) < 1e-6);
  assert.ok(Math.abs(colors[10] - NULL_COLOR[1]) < 1e-6);
});

test("grid lines: full grid has all row+column segments", () => {
  const mesh = buildGrid2dMesh(makeSurface());
  const lines = buildGrid2dGridLines(makeSurface(), mesh.positions);
  const segments = NJ * (NI - 1) + NI * (NJ - 1); // 16 + 15 = 31
  assert.equal(lines.positions.length, segments * 2 * 3);
});

test("grid lines: origin/axis ends sit on the lattice", () => {
  const mesh = buildGrid2dMesh(makeSurface());
  const lines = buildGrid2dGridLines(makeSurface(), mesh.positions);
  // origin node (0,0): x=100, y=200, z=0 (raw idx 0)
  assert.deepEqual(lines.origin, [100, 200, 0]);
  // I edge end node (ni-1=4, 0): x=100+4*10, y=200, z=4
  assert.deepEqual(lines.iAxisEnd, [140, 200, 4]);
  // J edge end node (0, nj-1=3): x=100, y=200+3*20, z=idx 15
  assert.deepEqual(lines.jAxisEnd, [100, 260, 15]);
});

test("grid lines: full lattice is drawn even across null nodes", () => {
  const nullIdx = 1 * NI + 2; // interior node (i=2,j=1)
  const mesh = buildGrid2dMesh(makeSurface(nullIdx));
  const lines = buildGrid2dGridLines(makeSurface(nullIdx), mesh.positions);
  // Nulls no longer drop segments: the grid spans the complete extent so null
  // cells stay visible as empty framed cells.
  const full = NJ * (NI - 1) + NI * (NJ - 1); // 31
  assert.equal(lines.positions.length, full * 2 * 3);
});

test("grid lines: reject positions of the wrong length", () => {
  assert.throws(() => buildGrid2dGridLines(makeSurface(), new Float32Array(3)));
});

test("axis annotations: caps tick count per axis and skips values", () => {
  // A wide surface so the raw ranges span many integers; ticks must stay sparse.
  const s = makeSurface();
  s.iStep = [1000, 0, 0]; // X spans 0..4000
  s.jStep = [0, 1000, 0]; // Y spans 0..3000
  const mesh = buildGrid2dMesh(s);
  const annotations = buildGrid2dAxisAnnotations(mesh, s, 1, 6);
  assert.ok(annotations.x.length <= 7, `x ticks=${annotations.x.length}`);
  assert.ok(annotations.y.length <= 7, `y ticks=${annotations.y.length}`);
  assert.ok(annotations.z.length <= 7, `z ticks=${annotations.z.length}`);
  // "Nice" spacing means more than one X tick but far fewer than the 5 columns.
  assert.ok(annotations.x.length >= 2);
});

test("axis annotations: ticks sit on their bounding-box edges", () => {
  const mesh = buildGrid2dMesh(makeSurface());
  const { min } = mesh.bounds;
  const annotations = buildGrid2dAxisAnnotations(mesh, makeSurface(), 1, 6);
  // X ticks vary X only; Y and Z pinned to the min corner.
  for (const tick of annotations.x) {
    assert.equal(tick.position[0], tick.value);
    assert.equal(tick.position[1], min[1]);
    assert.equal(tick.position[2], min[2]);
  }
  // Z ticks vary Z only; X and Y pinned to the min corner.
  for (const tick of annotations.z) {
    assert.equal(tick.position[0], min[0]);
    assert.equal(tick.position[1], min[1]);
    assert.equal(tick.position[2], tick.value); // zScale 1, no downward flip
  }
});

test("axis annotations: Z labels track exaggeration and downward flip", () => {
  const s = makeSurface();
  s.zIncreasingDownward = true;
  const mesh = buildGrid2dMesh(s, 3);
  const annotations = buildGrid2dAxisAnnotations(mesh, s, 3, 6);
  for (const tick of annotations.z) {
    // Label reports the raw elevation; position uses -1 * zScale.
    assert.equal(tick.position[2], tick.value * -1 * 3);
  }
});

test("axis annotations: origin and axis ends span the bounds", () => {
  const mesh = buildGrid2dMesh(makeSurface());
  const { min, max } = mesh.bounds;
  const annotations = buildGrid2dAxisAnnotations(mesh, makeSurface(), 1, 6);
  assert.deepEqual(annotations.origin, [min[0], min[1], min[2]]);
  assert.deepEqual(annotations.xAxisEnd, [max[0], min[1], min[2]]);
  assert.deepEqual(annotations.yAxisEnd, [min[0], max[1], min[2]]);
  assert.deepEqual(annotations.zAxisEnd, [min[0], min[1], max[2]]);
});

test("local annotations: labels are 0-based indices ending at ni-1/nj-1", () => {
  const mesh = buildGrid2dMesh(makeSurface());
  const local = buildGrid2dLocalAnnotations(makeSurface(), mesh.positions);
  assert.equal(local.i[0].index, 0);
  assert.equal(local.i[0].label, "0");
  assert.equal(local.i[local.i.length - 1].index, NI - 1);
  assert.equal(local.j[local.j.length - 1].index, NJ - 1);
  assert.ok(local.i.length <= 7 && local.j.length <= 7);
});

test("local annotations: ticks sit on the lattice edges from the origin", () => {
  const mesh = buildGrid2dMesh(makeSurface());
  const local = buildGrid2dLocalAnnotations(makeSurface(), mesh.positions);
  // origin node (0,0): x=100, y=200, z=0
  assert.deepEqual(local.origin, [100, 200, 0]);
  // I edge end (ni-1=4, 0): x=100+4*10, y=200
  assert.deepEqual(local.iAxisEnd, [140, 200, 4]);
  // J edge end (0, nj-1=3): x=100, y=200+3*20
  assert.deepEqual(local.jAxisEnd, [100, 260, 15]);
  // I ticks vary X only along the j=0 edge; J ticks vary Y only along i=0.
  for (const tick of local.i) assert.equal(tick.position[1], 200);
  for (const tick of local.j) assert.equal(tick.position[0], 100);
});

test("local annotations: reject positions of the wrong length", () => {
  assert.throws(() => buildGrid2dLocalAnnotations(makeSurface(), new Float32Array(3)));
});

console.log(`\n${passed} checks passed.`);