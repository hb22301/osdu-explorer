// Deletes a Storage Service record. Two semantics are offered:
//  - Soft delete (logical): recoverable, retains all versions. POST .../{id}:delete.
//  - Purge (hard): permanent, removes the record and every version. DELETE .../{id}.
// The server enforces the ACL/privilege each path requires, so any rejection is
// surfaced verbatim.

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${response.status})`;
}

export type StorageDeleteResult = { ok: true } | { ok: false; error: string };

export async function softDeleteStorageRecord(
  recordId: string,
  onStep?: (step: string) => void,
): Promise<StorageDeleteResult> {
  onStep?.("Soft deleting record…");
  const res = await fetch(`/api/osdu/records/${encodeURIComponent(recordId)}/delete`, {
    method: "POST",
  });
  if (!res.ok) return { ok: false, error: await readError(res, "Failed to delete record") };
  return { ok: true };
}

export async function purgeStorageRecord(
  recordId: string,
  onStep?: (step: string) => void,
): Promise<StorageDeleteResult> {
  onStep?.("Purging record…");
  const res = await fetch(`/api/osdu/records/${encodeURIComponent(recordId)}`, {
    method: "DELETE",
  });
  if (!res.ok) return { ok: false, error: await readError(res, "Failed to purge record") };
  return { ok: true };
}
