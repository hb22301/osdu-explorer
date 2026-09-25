// Cascade delete for Reservoir DDMS records. A single DELETE is refused (HTTP
// 412) while other records still reference the target, so the delete dialog
// first discovers that referencing set and, when the user confirms, deletes the
// whole set and the target together in one server-side transaction (atomic:
// either every record goes or none does). Pure logic — no `three` imports — so
// it stays in the Replit-safe layer and is driven by the browser check.

import type { RdmsDeleteResult } from "./rdms-record-delete";

export interface RdmsReferencer {
  uri: string;
  datatype: string;
  uuid: string;
  name: string;
}

export type RdmsDiscoverResult =
  | { ok: true; referencers: RdmsReferencer[]; truncated: boolean }
  | { ok: false; error: string };

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${response.status})`;
}

// Extra guidance for the cascade path, layered on top of the single-delete
// guidance. A referential error *after* a cascade means the reference graph
// shifted between preview and delete, so the fix is to re-check, not to remove
// references by hand.
export function getRdmsCascadeGuidance(error: string): string {
  const normalized = error.toLowerCase();
  if (/(referenc|depend|integrity|dangling)/.test(normalized)) {
    return "Reservoir DDMS still reports references after the cascade, so nothing was deleted and the records are unchanged. The set of referencing records likely changed since it was listed — close this dialog and try again to re-check.";
  }
  if (/(could not reach|failed to fetch|network|timed out|connection)/.test(normalized)) {
    return "The request could not reach the server, so the records are unchanged. Check your connection and Reservoir DDMS availability, then try again.";
  }
  return "Reservoir DDMS refused the cascade deletion and rolled it back, so all the records are still available. Check the error details and your Reservoir DDMS access, then try again.";
}

// Lists the records that reference the target (its transitive "referenced-by"
// closure). An empty list means the target can be deleted on its own.
export async function discoverRdmsReferencers(
  dataspace: string,
  datatype: string,
  uuid: string,
): Promise<RdmsDiscoverResult> {
  let res: Response;
  try {
    res = await fetch(
      `/api/osdu/rdms/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(uuid)}/sources`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Could not reach the server to check references: ${detail}` };
  }
  if (!res.ok) return { ok: false, error: await readError(res, "Failed to check references") };
  const body = (await res.json().catch(() => null)) as
    | { referencers?: RdmsReferencer[]; truncated?: boolean }
    | null;
  return {
    ok: true,
    referencers: Array.isArray(body?.referencers) ? body.referencers : [],
    truncated: Boolean(body?.truncated),
  };
}

// Deletes the confirmed referencer set and the target atomically. `referencers`
// is exactly the list the user confirmed, so the blast radius matches what they
// saw in the dialog.
export async function cascadeDeleteRdmsRecord(
  dataspace: string,
  datatype: string,
  uuid: string,
  referencers: Array<{ datatype: string; uuid: string }>,
  onStep?: (step: string) => void,
): Promise<RdmsDeleteResult> {
  onStep?.(`Deleting ${referencers.length + 1} records together…`);
  let res: Response;
  try {
    res = await fetch(`/api/osdu/rdms/dataspaces/${encodeURIComponent(dataspace)}/cascade-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: { datatype, uuid },
        referencers: referencers.map((r) => ({ datatype: r.datatype, uuid: r.uuid })),
      }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Could not reach the server to delete the records: ${detail}` };
  }
  if (!res.ok) return { ok: false, error: await readError(res, "Failed to delete records") };
  return { ok: true };
}
