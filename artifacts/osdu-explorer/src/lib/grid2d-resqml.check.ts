import assert from "node:assert/strict";
import { buildGrid2dMesh } from "./grid2d-mesh";
import { resolveGrid2dLattice } from "./grid2d-resqml";

const lattice = resolveGrid2dLattice({
  Origin: { Coordinate1: 100, Coordinate2: 200, Coordinate3: 0 },
  // RESQML orders these by slowest then fastest axis: J first, I second.
  // The unequal spacing makes an accidental I/J exchange visible.
  Offset: [
    {
      Offset: { Coordinate1: 0, Coordinate2: 1, Coordinate3: 0 },
      Spacing: { Value: 20, Count: 1 },
    },
    {
      Offset: { Coordinate1: 1, Coordinate2: 0, Coordinate3: 0 },
      Spacing: { Value: 10, Count: 2 },
    },
  ],
});

assert.deepEqual(lattice, {
  origin: [100, 200, 0],
  iStep: [10, 0, 0],
  jStep: [0, 20, 0],
});

const mesh = buildGrid2dMesh({
  ni: 3,
  nj: 2,
  z: new Float32Array([0, 1, 2, 3, 4, 5]),
  ...lattice!,
  title: "Coordinate order regression",
});
const node = (1 * 3 + 2) * 3;
assert.equal(mesh.positions[node], 120, "Coordinate1 should map to world X");
assert.equal(mesh.positions[node + 1], 220, "Coordinate2 should map to world Y");

console.log("Grid2d RESQML coordinate-order checks passed.");