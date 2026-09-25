// Parses Energistics object URIs returned by the Reservoir DDMS `/sources`
// endpoint (and by ETP) into the { datatype, uuid } pair the delete routes
// address. Handles both the bare form
//   eml:///dataspace('demo/Volve')/resqml20.obj_TriangulatedSetRepresentation(a3f31b20-...)
// and the version-qualified form
//   .../type(uuid=a3f31b20-...,version='2024-01-01T00:00:00Z')
// Returns null when the URI is not a data-object URI (e.g. a dataspace-only URI).

export interface RdmsObjectRef {
  datatype: string;
  uuid: string;
}

export function parseObjectUri(uri: unknown): RdmsObjectRef | null {
  if (typeof uri !== "string") return null;
  const match = /\/([^/()]+)\(([^)]*)\)\s*$/.exec(uri);
  if (!match) return null;
  const datatype = match[1];
  const inner = match[2];
  const uuidField = /(?:^|,)\s*uuid\s*=\s*([^,]+)/i.exec(inner);
  const raw = uuidField ? uuidField[1] : inner;
  const uuid = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!datatype || !uuid) return null;
  return { datatype, uuid };
}

// Reads a transaction id out of a POST-transactions response, which some
// servers return as a bare string and others wrap in an object.
export function extractTransactionId(data: unknown): string | null {
  if (typeof data === "string") return data.length > 0 ? data : null;
  if (data && typeof data === "object") {
    for (const key of ["transactionId", "id", "uuid", "transaction"] as const) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return null;
}
