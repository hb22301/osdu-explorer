// Deletes a Reservoir DDMS record via a single DELETE on its resource URI.
// The Reservoir DDMS server rejects the delete when other objects still
// reference this one, so any referential-integrity error is surfaced verbatim.

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${response.status})`;
}

export type RdmsDeleteResult = { ok: true } | { ok: false; error: string };

export async function deleteRdmsRecord(
  dataspace: string,
  datatype: string,
  uuid: string,
  onStep?: (step: string) => void,
): Promise<RdmsDeleteResult> {
  onStep?.("Deleting record…");
  const res = await fetch(
    `/api/osdu/rdms/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(uuid)}`,
    { method: "DELETE" },
  );
  if (!res.ok) return { ok: false, error: await readError(res, "Failed to delete record") };
  return { ok: true };
}
