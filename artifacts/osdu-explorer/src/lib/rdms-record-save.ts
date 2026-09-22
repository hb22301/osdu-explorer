// Saves an edited Reservoir DDMS record via the 3-step transaction flow:
// create a transaction, PUT the updated resource under that transaction, then
// commit. On any failure the sequence stops before committing, so the open
// transaction is left to expire on its own (per the TimeoutPeriod sent below).

export function parseTransactionId(data: unknown): string | null {
  if (typeof data === "string") return data.trim() || null;
  if (typeof data === "number") return String(data);
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const candidate =
      record.transactionId ?? record.TransactionId ?? record.transaction_id ?? record.id ?? record.Id;
    if (typeof candidate === "string") return candidate.trim() || null;
    if (typeof candidate === "number") return String(candidate);
  }
  return null;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${response.status})`;
}

export type RdmsSaveResult = { ok: true } | { ok: false; error: string };

export async function saveRdmsRecord(
  dataspace: string,
  records: unknown[],
  onStep?: (step: string) => void,
): Promise<RdmsSaveResult> {
  const ds = encodeURIComponent(dataspace);

  onStep?.("Creating transaction…");
  const txRes = await fetch(`/api/osdu/rdms/dataspaces/${ds}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ TimeoutPeriod: 300, Retries: 2 }),
  });
  if (!txRes.ok) return { ok: false, error: await readError(txRes, "Failed to create transaction") };
  const transactionId = parseTransactionId(await txRes.json());
  if (!transactionId) return { ok: false, error: "Transaction created but no transaction id was returned." };

  onStep?.("Updating record…");
  const putRes = await fetch(
    `/api/osdu/rdms/dataspaces/${ds}/resources?transactionId=${encodeURIComponent(transactionId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(records),
    },
  );
  if (!putRes.ok) return { ok: false, error: await readError(putRes, "Failed to update record") };

  onStep?.("Committing transaction…");
  const commitRes = await fetch(
    `/api/osdu/rdms/dataspaces/${ds}/transactions/${encodeURIComponent(transactionId)}`,
    { method: "PUT" },
  );
  if (!commitRes.ok) return { ok: false, error: await readError(commitRes, "Failed to commit transaction") };

  return { ok: true };
}
