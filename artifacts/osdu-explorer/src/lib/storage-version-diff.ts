// Diffs two versions of a Storage record into a flat, path-keyed change list.
// Pure logic (no three / DOM imports) so it stays Replit-safe and unit-testable.

export type ChangeKind = "added" | "removed" | "changed";

export interface FieldChange {
  /** JSON path to the field, e.g. "data.Markers[0].Name". */
  path: string;
  kind: ChangeKind;
  /** Value in the base version (absent for "added"). */
  before?: unknown;
  /** Value in the target version (absent for "removed"). */
  after?: unknown;
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  total: number;
}

type Json = unknown;

function isPlainObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Deep structural equality — order-insensitive for object keys so a reordered
// (but otherwise identical) record reports no changes.
function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function joinPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

// Walk both trees in parallel, appending a change per differing leaf/subtree.
// Objects recurse by key (order-insensitive); arrays recurse by index.
function walk(base: Json, target: Json, path: string, out: FieldChange[]): void {
  if (deepEqual(base, target)) return;

  if (isPlainObject(base) && isPlainObject(target)) {
    const keys = [...new Set([...Object.keys(base), ...Object.keys(target)])].sort();
    for (const key of keys) {
      const inBase = key in base;
      const inTarget = key in target;
      const childPath = joinPath(path, key);
      if (inBase && !inTarget) out.push({ path: childPath, kind: "removed", before: base[key] });
      else if (!inBase && inTarget) out.push({ path: childPath, kind: "added", after: target[key] });
      else walk(base[key], target[key], childPath, out);
    }
    return;
  }

  if (Array.isArray(base) && Array.isArray(target)) {
    const max = Math.max(base.length, target.length);
    for (let i = 0; i < max; i++) {
      const inBase = i < base.length;
      const inTarget = i < target.length;
      const childPath = `${path}[${i}]`;
      if (inBase && !inTarget) out.push({ path: childPath, kind: "removed", before: base[i] });
      else if (!inBase && inTarget) out.push({ path: childPath, kind: "added", after: target[i] });
      else walk(base[i], target[i], childPath, out);
    }
    return;
  }

  // Leaf or a type change (object↔array↔primitive): report the whole value.
  out.push({ path: path || "(root)", kind: "changed", before: base, after: target });
}

// Diff base → target, returning changes sorted by path for stable rendering.
export function diffRecords(
  base: Record<string, unknown>,
  target: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  walk(base, target, "", changes);
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export function summarizeChanges(changes: FieldChange[]): DiffSummary {
  const summary: DiffSummary = { added: 0, removed: 0, changed: 0, total: changes.length };
  for (const change of changes) summary[change.kind]++;
  return summary;
}

// System fields change on nearly every write; grouping them apart from data.*
// keeps the signal (payload changes) out of the noise when debugging.
const SYSTEM_FIELD_ROOTS = new Set([
  "version",
  "modifyTime",
  "modifyUser",
  "createTime",
  "createUser",
  "meta",
  "acl",
  "legal",
  "ancestry",
  "tags",
]);

// True when a change's top-level path segment is an OSDU system field.
export function isSystemFieldChange(change: FieldChange): boolean {
  const root = change.path.split(/[.[]/)[0];
  return SYSTEM_FIELD_ROOTS.has(root);
}
