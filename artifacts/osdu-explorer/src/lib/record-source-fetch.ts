export type RecordSource = "search" | "storage";

function quoteLuceneValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function fetchSearchRecordById(
  id: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch("/api/osdu/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "*:*:*:*",
      query: `id:"${quoteLuceneValue(id)}"`,
      limit: 1,
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Search failed (HTTP ${response.status})`);

  const data = await response.json() as { results?: unknown[] };
  const record = data.results?.[0];
  if (!record) throw new Error("No Search result found for this record ID");
  return record;
}

export async function fetchStorageRecordById(
  id: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`/api/osdu/records/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "Storage record not found"
        : `Storage lookup failed (HTTP ${response.status})`,
    );
  }
  return response.json();
}