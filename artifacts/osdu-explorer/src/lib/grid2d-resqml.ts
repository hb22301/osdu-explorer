export interface Grid2dLattice {
  /** RESQML Coordinate1 is the world X coordinate. */
  origin: [number, number, number];
  /** Step along the fastest (I) axis, with Coordinate1 -> X and Coordinate2 -> Y. */
  iStep: [number, number, number];
  /** Step along the slowest (J) axis, with Coordinate1 -> X and Coordinate2 -> Y. */
  jStep: [number, number, number];
}

function readNode(node: unknown, keys: string[]): unknown {
  let current = node;
  for (const key of keys) {
    if (Array.isArray(current)) current = current[0];
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
    if (current === null || current === undefined) return undefined;
  }
  return current;
}

function readNumber(node: unknown, keys: string[]): number | undefined {
  const value = readNode(node, keys);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Resolve the XY lattice from RESQML Point3dLatticeArray SupportingGeometry.
 * Offset entries are ordered slowest axis (J) first, fastest axis (I) second;
 * coordinate components remain in CRS order: Coordinate1 -> X, Coordinate2 -> Y.
 */
export function resolveGrid2dLattice(supportingGeometry: unknown): Grid2dLattice | undefined {
  const ox = readNumber(supportingGeometry, ["Origin", "Coordinate1"]);
  const oy = readNumber(supportingGeometry, ["Origin", "Coordinate2"]);
  const oz = readNumber(supportingGeometry, ["Origin", "Coordinate3"]) ?? 0;
  const offsetNode = readNode(supportingGeometry, ["Offset"]);
  const offsets = Array.isArray(offsetNode) ? offsetNode : [];

  const step = (offset: unknown): [number, number, number] | undefined => {
    if (!offset) return undefined;
    const dx = readNumber(offset, ["Offset", "Coordinate1"]);
    const dy = readNumber(offset, ["Offset", "Coordinate2"]);
    const dz = readNumber(offset, ["Offset", "Coordinate3"]) ?? 0;
    const spacing =
      readNumber(offset, ["Spacing", "Value"]) ??
      readNumber(offset, ["Spacing", "Values", "Value"]);
    if (dx === undefined || dy === undefined || spacing === undefined) return undefined;
    return [dx * spacing, dy * spacing, dz * spacing];
  };

  const jStep = step(offsets[0]);
  const iStep = step(offsets[1]);
  if (ox === undefined || oy === undefined || !iStep || !jStep) return undefined;

  return {
    origin: [ox, oy, oz],
    iStep,
    jStep,
  };
}