// Prepares a Storage Service record for cloning and drives the create request.
// OSDU's PUT /records is an upsert: a record WITHOUT an id is created fresh, so a
// clone is just the original with the server-managed identity fields stripped.
// Kept free of any `three` import so it stays Replit-safe.

// Fields OSDU assigns/maintains itself; carrying them over would either target
// the original record (id/version) or send values the store rejects on write.
const SERVER_MANAGED_FIELDS = [
  "id",
  "version",
  "createUser",
  "createTime",
  "modifyUser",
  "modifyTime",
  "ancestry",
] as const;

// Response-only fields the storage save path already strips before a PUT; a
// cloned create sends through the same shape, so mirror that here.
const RESPONSE_ONLY_FIELDS = ["meta", "ancestry", "tags"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripServerFields(record: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...record };
  for (const field of SERVER_MANAGED_FIELDS) delete clone[field];
  return clone;
}

export type ClonePrepareResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

// Parses the displayed record JSON and returns pretty-printed JSON with the
// server-managed identity fields removed, ready to edit and create as a new
// record. Preserves single-object vs array shape so the editor round-trips it.
export function prepareRecordClone(json: string): ClonePrepareResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid JSON" };
  }
  const wasArray = Array.isArray(parsed);
  const records = wasArray ? (parsed as unknown[]) : [parsed];
  if (records.length === 0) return { ok: false, error: "No record to clone." };
  const cloned = records.map((record) =>
    isRecord(record) ? stripServerFields(record) : record,
  );
  const value = JSON.stringify(wasArray ? cloned : cloned[0], null, 2);
  return { ok: true, value };
}

export type CreateResult =
  | { ok: true; recordIds: string[] }
  | { ok: false; error: string };

// Creates records via the upsert endpoint the edit path already uses. Records
// without an id are created fresh by OSDU; the returned recordIds are surfaced
// so the user can see (and open) what was created.
export async function createStorageRecords(
  records: unknown[],
  onStep?: (step: string) => void,
): Promise<CreateResult> {
  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, error: "No record to create." };
  }
  onStep?.("Creating record…");
  const payload = records.map((record) => {
    if (!isRecord(record)) return record;
    const editable = { ...record };
    for (const field of RESPONSE_ONLY_FIELDS) delete editable[field];
    return editable;
  });

  let res: Response;
  try {
    res = await fetch("/api/osdu/records", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "Could not reach the Storage Service." };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `Failed to create record (HTTP ${res.status}).` };
  }

  const body = (await res.json().catch(() => null)) as { recordIds?: unknown } | null;
  const recordIds = Array.isArray(body?.recordIds)
    ? body.recordIds.filter((id): id is string => typeof id === "string")
    : [];
  return { ok: true, recordIds };
}
