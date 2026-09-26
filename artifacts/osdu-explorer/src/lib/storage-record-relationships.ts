// Detects references from one OSDU record to other records so the viewer can
// offer click-through navigation (parent/child and other relationships).

export interface RecordRelationship {
  /** JSON path where the reference was found, e.g. "data.WellboreID". */
  path: string;
  /** Navigable OSDU record id (any trailing version is stripped). */
  id: string;
  /** The reference exactly as it appears in the record. */
  raw: string;
}

const MAX_DEPTH = 12;

// An OSDU record id carries the `--` group delimiter (e.g. "master-data--Well")
// and has the shape partition:type:unique with an optional trailing version.
// A kind (authority:source:entity:x.y.z) is excluded by its trailing semver.
export function looksLikeOsduRecordId(value: string): boolean {
  if (typeof value !== "string" || !value.includes("--")) return false;
  if ((value.match(/:/g)?.length ?? 0) < 2) return false;
  if (/:\d+\.\d+\.\d+$/.test(value)) return false;
  return true;
}

// Strip a trailing version so the id can be fetched. partition:type:unique is
// the canonical id; any 4th segment (a version number, or empty from a trailing
// colon) is dropped.
export function normalizeRecordId(raw: string): string {
  const segments = raw.split(":");
  return segments.length > 3 ? segments.slice(0, 3).join(":") : raw;
}

// Walk a record and collect every distinct record it references. The record's
// own id and kind are skipped, as are duplicate references (deduped by id).
export function findRecordRelationships(record: unknown): RecordRelationship[] {
  const found: RecordRelationship[] = [];
  const seen = new Set<string>();

  // Seed with the record's own id so self-references are not offered.
  if (record && typeof record === "object" && !Array.isArray(record)) {
    const ownId = (record as Record<string, unknown>).id;
    if (typeof ownId === "string" && looksLikeOsduRecordId(ownId)) {
      seen.add(normalizeRecordId(ownId));
    }
  }

  const visit = (value: unknown, path: string, depth: number): void => {
    if (value == null || depth > MAX_DEPTH) return;
    if (typeof value === "string") {
      if (path === "id" || path === "kind") return;
      if (!looksLikeOsduRecordId(value)) return;
      const id = normalizeRecordId(value);
      if (seen.has(id)) return;
      seen.add(id);
      found.push({ path, id, raw: value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  };

  visit(record, "", 0);
  return found;
}
