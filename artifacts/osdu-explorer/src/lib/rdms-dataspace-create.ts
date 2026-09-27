// Validates a proposed Reservoir DDMS dataspace name and creates it via the
// backend proxy (PUT /api/osdu/rdms/dataspaces/{name}). Dependency-free and
// Replit-safe (no `three`); the validator is covered by the unit check.

export type NameValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

// RDDMS dataspace paths are one or more segments of letters, digits, '.', '-',
// and '_', joined by '/'. e.g. "PDS-Preview/Agentic_CWP".
const DATASPACE_NAME_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export function validateDataspaceName(raw: string, existing: string[] = []): NameValidation {
  const value = raw.trim();
  if (!value) return { ok: false, error: "Enter a dataspace name." };
  if (/\s/.test(value)) return { ok: false, error: "Dataspace name cannot contain spaces." };
  if (value.startsWith("/") || value.endsWith("/")) {
    return { ok: false, error: "Dataspace name cannot start or end with a slash." };
  }
  if (value.includes("//")) {
    return { ok: false, error: "Dataspace name cannot contain empty path segments." };
  }
  if (!DATASPACE_NAME_PATTERN.test(value)) {
    return { ok: false, error: "Use only letters, numbers, '.', '-', '_', and '/' as a separator." };
  }
  if (existing.some((ds) => ds === value)) {
    return { ok: false, error: "A dataspace with this name already exists." };
  }
  return { ok: true, value };
}

export type DataspaceCreateResult = { ok: true } | { ok: false; error: string };

export async function createDataspace(name: string, signal?: AbortSignal): Promise<DataspaceCreateResult> {
  const response = await fetch(`/api/osdu/rdms/dataspaces/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `Failed to create dataspace (HTTP ${response.status})` };
  }
  return { ok: true };
}
