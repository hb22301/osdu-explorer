// Deletes a Reservoir DDMS record via a single DELETE on its resource URI.
// The Reservoir DDMS REST API treats this delete as self-committing: when no
// transactionId is supplied the server opens, deletes, and commits its own
// session, so one request removes the record. The server rejects the delete
// when other objects still reference this one, so any referential-integrity
// error is surfaced verbatim.

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${response.status})`;
}

export type RdmsDeleteResult =
  | { ok: true }
  | { ok: false; error: string; status?: number };

export function getRdmsDeleteGuidance(error: string): string {
  const normalized = error.toLowerCase();
  if (/(referenc|depend|foreign key|integrity)/.test(normalized)) {
    return "Reservoir DDMS refused this deletion because another object still references this record. Remove or update those references first, then try again.";
  }
  if (/(could not reach|failed to fetch|network|timed out|connection)/.test(normalized)) {
    return "The delete request could not reach the server, so the record is unchanged. Check your connection and Reservoir DDMS availability, then try again.";
  }
  return "Reservoir DDMS refused the deletion, so the record is still available. Check the error details and your Reservoir DDMS access, then try again.";
}

export async function deleteRdmsRecord(
  dataspace: string,
  datatype: string,
  uuid: string,
  onStep?: (step: string) => void,
): Promise<RdmsDeleteResult> {
  onStep?.("Deleting record…");
  let res: Response;
  try {
    res = await fetch(
      `/api/osdu/rdms/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(uuid)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    // A thrown fetch (offline, DNS, aborted, CORS) must resolve to a result so
    // the caller always clears its in-flight state — otherwise the confirmation
    // dialog stays open with disabled buttons and a spinner that never stops.
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Could not reach the server to delete the record: ${detail}` };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: await readError(res, "Failed to delete record"),
      status: res.status,
    };
  }
  return { ok: true };
}
