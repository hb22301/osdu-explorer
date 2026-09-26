// Fetches a specific version of a Storage record.

export async function fetchStorageRecordVersion(
  recordId: string,
  version: number,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `/api/osdu/records/${encodeURIComponent(recordId)}?version=${version}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch version ${version}: HTTP ${response.status}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}
