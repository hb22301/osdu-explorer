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

// Permanently purge specific (non-latest) versions of a record. OSDU never
// deletes the latest version, so callers must exclude it. DELETE .../{id}/versions.
export async function deleteStorageRecordVersions(
  recordId: string,
  versionIds: number[],
): Promise<StorageDeleteResult> {
  if (versionIds.length === 0) return { ok: true };
  const ids = encodeURIComponent(versionIds.join(","));
  const res = await fetch(
    `/api/osdu/records/${encodeURIComponent(recordId)}/versions?versionIds=${ids}`,
    { method: "DELETE" },
  );
  if (!res.ok) return { ok: false, error: await readError(res, "Failed to delete record versions") };
  return { ok: true };
}
