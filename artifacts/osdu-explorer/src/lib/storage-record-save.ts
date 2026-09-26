// Saves an edited Storage Service record via a single PUT to the records
// endpoint. The Storage API accepts an array of records, so the edited record
// is wrapped in an array before it is sent.

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${response.status})`;
}

export type StorageSaveResult = { ok: true } | { ok: false; error: string };

export async function saveStorageRecord(
  records: unknown[],
  onStep?: (step: string) => void,
): Promise<StorageSaveResult> {
  onStep?.("Saving record…");
  const recordsForUpdate = records.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return record;

    const editableRecord = { ...(record as Record<string, unknown>) };
    delete editableRecord.meta;
    delete editableRecord.ancestry;
    delete editableRecord.tags;
    return editableRecord;
  });

  const res = await fetch("/api/osdu/records", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(recordsForUpdate),
  });
  if (!res.ok) return { ok: false, error: await readError(res, "Failed to save record") };
  return { ok: true };
}