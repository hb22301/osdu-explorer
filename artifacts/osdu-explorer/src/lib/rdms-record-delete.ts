// Deletes a Reservoir DDMS record through the same transaction lifecycle used
// for updates: create, mutate with transactionId, then commit.
// The Reservoir DDMS server rejects the delete when other objects still
// reference this one, so any referential-integrity error is surfaced verbatim.

import { parseTransactionId } from "@/lib/rdms-record-save";

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${response.status})`;
}

export type RdmsDeleteResult = { ok: true } | { ok: false; error: string };

export function getRdmsDeleteGuidance(error: string): string {
  const normalized = error.toLowerCase();
  if (/(referenc|depend|foreign key|integrity)/.test(normalized)) {
    return "Reservoir DDMS refused this deletion because another object still references this record. Remove or update those references first, then try again.";
  }
  return "Reservoir DDMS refused the deletion, so the record is still available. Check the error details and your Reservoir DDMS access, then try again.";
}

export async function deleteRdmsRecord(
  dataspace: string,
  datatype: string,
  uuid: string,
  onStep?: (step: string) => void,
): Promise<RdmsDeleteResult> {
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

  onStep?.("Deleting record…");
  const deleteRes = await fetch(
    `/api/osdu/rdms/dataspaces/${ds}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(uuid)}?transactionId=${encodeURIComponent(transactionId)}`,
    { method: "DELETE" },
  );
  if (!deleteRes.ok) return { ok: false, error: await readError(deleteRes, "Failed to delete record") };

  onStep?.("Committing transaction…");
  const commitRes = await fetch(
    `/api/osdu/rdms/dataspaces/${ds}/transactions/${encodeURIComponent(transactionId)}`,
    { method: "PUT" },
  );
  if (!commitRes.ok) return { ok: false, error: await readError(commitRes, "Failed to commit transaction") };

  return { ok: true };
}
