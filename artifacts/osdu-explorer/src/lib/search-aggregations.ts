// Pure helpers plus a thin fetch wrapper for OSDU Search aggregations. The
// dashboard uses these to show a "records by kind" breakdown across the whole
// query window (not just the current page). Dependency-free and Replit-safe
// (no `three`); the transform functions are covered by the unit check.

export interface AggregationBucket {
  key: string;
  count: number;
}

// Parse a /api/osdu/search response into buckets sorted by descending count
// (ties broken alphabetically for a stable order). Tolerates a missing or
// malformed `aggregations` field.
export function parseAggregationResponse(json: unknown): AggregationBucket[] {
  const raw = (json && typeof json === "object" ? (json as Record<string, unknown>).aggregations : undefined);
  if (!Array.isArray(raw)) return [];
  const buckets: AggregationBucket[] = [];
  for (const item of raw) {
    const bucket = (item ?? {}) as Record<string, unknown>;
    if (typeof bucket.key === "string" && typeof bucket.count === "number") {
      buckets.push({ key: bucket.key, count: bucket.count });
    }
  }
  return sortBuckets(buckets);
}

export function sortBuckets(buckets: AggregationBucket[]): AggregationBucket[] {
  return [...buckets].sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
}

export function aggregationTotal(buckets: AggregationBucket[]): number {
  return buckets.reduce((sum, b) => sum + b.count, 0);
}

export interface CollapsedBuckets {
  top: AggregationBucket[];
  otherCount: number;
  otherKinds: number;
}

// Keep the top `n` buckets and roll the rest into a single "Other" tally, so a
// partition with hundreds of kinds still renders a readable chart.
export function collapseBuckets(buckets: AggregationBucket[], n: number): CollapsedBuckets {
  const sorted = sortBuckets(buckets);
  if (sorted.length <= n) return { top: sorted, otherCount: 0, otherKinds: 0 };
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n);
  return {
    top,
    otherCount: rest.reduce((sum, b) => sum + b.count, 0),
    otherKinds: rest.length,
  };
}

// Shorten an OSDU kind for display: prefer the entity name after "--", else the
// segment after the last ":". `osdu:wks:master-data--Well:1.0.0` → `Well`.
export function shortKind(kind: string): string {
  const dd = kind.indexOf("--");
  if (dd >= 0) {
    const afterEntity = kind.slice(dd + 2);
    const colon = afterEntity.indexOf(":");
    return colon >= 0 ? afterEntity.slice(0, colon) : afterEntity;
  }
  const lastColon = kind.lastIndexOf(":");
  return lastColon >= 0 ? kind.slice(lastColon + 1) : kind;
}

// Fetch a field breakdown for a query. `limit: 0` asks OSDU for just the
// aggregation + total, keeping the payload small.
export async function fetchAggregation(
  aggregateBy: string,
  query: string | undefined,
  signal?: AbortSignal,
): Promise<AggregationBucket[]> {
  const response = await fetch("/api/osdu/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "*:*:*:*",
      ...(query ? { query } : {}),
      limit: 0,
      aggregateBy,
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Aggregation query failed (HTTP ${response.status})`);
  return parseAggregationResponse(await response.json());
}
