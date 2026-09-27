export interface AggregationBucket { key: string; count: number; }

const leading: AggregationBucket[] = [
  { key: "osdu:wks:reference-data--DataQuality:1.0.0", count: 338 },
  { key: "osdu:wks:master-data--Well:1.0.0", count: 322 },
  { key: "osdu:wks:master-data--Wellbore:1.0.0", count: 32 },
  { key: "osdu:wks:reference-data--OsduDomain:1.0.0", count: 31 },
  { key: "osdu:wks:reference-data--IndexableElement:1.0.0", count: 28 },
  { key: "osdu:wks:reference-data--OSDUJsonExtensions:1.0.0", count: 20 },
  { key: "osdu:wks:reference-data--BitReasonPulled:1.0.0", count: 19 },
  { key: "osdu:wks:reference-data--WeatherType:1.0.0", count: 16 },
];
const tail: AggregationBucket[] = Array.from({ length: 62 }, (_, index) => ({
  key: "osdu:wks:reference-data--SampleKind" + String(index + 1).padStart(2, "0") + ":1.0.0",
  count: index < 29 ? 5 : 4,
}));
export const MOCK_BUCKETS = [...leading, ...tail];

export function sortBuckets(buckets: AggregationBucket[]): AggregationBucket[] {
  return [...buckets].sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
}
export function aggregationTotal(buckets: AggregationBucket[]): number {
  return buckets.reduce((sum, bucket) => sum + bucket.count, 0);
}
export function collapseBuckets(buckets: AggregationBucket[], n: number) {
  const sorted = sortBuckets(buckets);
  if (sorted.length <= n) return { top: sorted, otherCount: 0, otherKinds: 0 };
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n);
  return { top, otherCount: rest.reduce((sum, bucket) => sum + bucket.count, 0), otherKinds: rest.length };
}
export function shortKind(kind: string): string {
  const dash = kind.indexOf("--");
  if (dash >= 0) { const entity = kind.slice(dash + 2); const colon = entity.indexOf(":"); return colon >= 0 ? entity.slice(0, colon) : entity; }
  const colon = kind.lastIndexOf(":");
  return colon >= 0 ? kind.slice(colon + 1) : kind;
}
export async function fetchAggregation(_aggregateBy: string, _query?: string, _signal?: AbortSignal): Promise<AggregationBucket[]> {
  return MOCK_BUCKETS;
}
