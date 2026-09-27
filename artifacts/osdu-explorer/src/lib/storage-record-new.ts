// Builds a create-ready skeleton for a new Storage record of a given kind.
// Produces the minimal valid envelope ({kind, acl, legal, data}) and does a
// best-effort *shallow* peek at the schema to stub the record's own inline data
// fields. It deliberately does NOT resolve $ref/allOf-referenced schemas — those
// abstract fragments are skipped, so the stub is partial-but-honest rather than a
// tree of empty placeholders. Kept free of any `three` import (Replit-safe).

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The empty value a JSON-Schema property should seed, by its declared type.
// Returns undefined when the shape can't be known without resolving a $ref, so
// the caller omits the field rather than guessing.
function emptyValueForProperty(prop: unknown): unknown {
  if (!isRecord(prop)) return undefined;
  const type = typeof prop.type === "string" ? prop.type : undefined;
  switch (type) {
    case "string":
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
  }
  // No declared type: only safe to stub when inline object properties are given.
  if (isRecord(prop.properties)) return {};
  return undefined;
}

// Collects the inline `properties` a data node declares directly and through any
// non-$ref allOf fragments. $ref-only fragments (the abstract, referenced part)
// are skipped since resolving them would need more schema fetches.
function collectInlineProperties(node: unknown): Record<string, unknown> {
  const collected: Record<string, unknown> = {};
  const merge = (candidate: unknown): void => {
    if (!isRecord(candidate)) return;
    if (isRecord(candidate.properties)) Object.assign(collected, candidate.properties);
    if (Array.isArray(candidate.allOf)) {
      for (const fragment of candidate.allOf) {
        if (isRecord(fragment) && !("$ref" in fragment)) merge(fragment);
      }
    }
  };
  merge(node);
  return collected;
}

// Scaffolds the `data` object from a schema document's inline data properties.
// Accepts either the OSDU schema document ({schema: {...}}) or a bare JSON-Schema
// body, and returns {} when nothing usable is present.
export function scaffoldDataFromSchema(schemaDoc: unknown): Record<string, unknown> {
  const root = isRecord(schemaDoc) && isRecord(schemaDoc.schema) ? schemaDoc.schema : schemaDoc;
  if (!isRecord(root) || !isRecord(root.properties)) return {};
  const dataNode = root.properties.data;
  const props = collectInlineProperties(dataNode);
  const data: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(props)) {
    const value = emptyValueForProperty(prop);
    if (value !== undefined) data[key] = value;
  }
  return data;
}

// Returns pretty-printed JSON for a brand-new record of `kind`: the minimal
// valid envelope with an id-less body (OSDU assigns the id on create), plus any
// inline data fields the optional schema exposes.
export function buildNewRecordTemplate(kind: string, schemaDoc?: unknown): string {
  const record = {
    kind,
    acl: { owners: [] as string[], viewers: [] as string[] },
    legal: { legaltags: [] as string[], otherRelevantDataCountries: [] as string[] },
    data: schemaDoc === undefined ? {} : scaffoldDataFromSchema(schemaDoc),
  };
  return JSON.stringify(record, null, 2);
}
