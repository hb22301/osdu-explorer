// Parses the Reservoir DDMS dataspace listing while preserving the metadata the
// store returns — path/uri, store timestamps, and custom data — instead of
// collapsing each entry to a bare name. REST returns an array of dataspace
// objects; ETP is proxied as { dataspaces: [...] } of objects or bare strings.
export interface DataspaceInfo {
  name: string;
  path?: string;
  uri?: string;
  storeCreated?: string;
  storeLastWrite?: string;
  customData?: Record<string, string>;
}

// A dataspace URI looks like eml:///dataspace('PDS-Preview/CWP') — pull the name
// from the parentheses; otherwise use the value as-is.
export function extractDataspaceName(raw: string): string {
  const m = raw.match(/dataspace\('([^']+)'\)/);
  return m ? m[1] : raw;
}

function pickString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}

// customData values are usually strings but can arrive as arrays/objects; keep
// them displayable by stringifying non-strings.
function toStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as const,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function parseDataspaceList(data: unknown): DataspaceInfo[] {
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    items = Array.isArray(d.data) ? d.data : Array.isArray(d.dataspaces) ? d.dataspaces : [];
  }
  return items.map((it) => {
    if (typeof it === "string") return { name: extractDataspaceName(it) };
    if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      const nameSource =
        pickString(o, "name") ??
        pickString(o, "id") ??
        pickString(o, "path") ??
        pickString(o, "uri") ??
        JSON.stringify(it);
      return {
        name: extractDataspaceName(nameSource),
        path: pickString(o, "path"),
        uri: pickString(o, "uri"),
        storeCreated: pickString(o, "storeCreated"),
        storeLastWrite: pickString(o, "storeLastWrite"),
        customData: toStringMap(o.customData),
      };
    }
    return { name: String(it) };
  });
}

// Reservoir DDMS returns epoch-zero timestamps (1970-01-01 / 0001-01-01) for
// dataspaces without a recorded time — treat those as "no timestamp".
export function isMeaningfulTimestamp(iso?: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t > 0;
}

export function customDataEntries(customData?: Record<string, string>): Array<[string, string]> {
  if (!customData) return [];
  return Object.entries(customData).filter(([key]) => key.trim());
}

// Whether a dataspace carries anything worth surfacing beyond its name.
export function hasDisplayableMetadata(info: DataspaceInfo): boolean {
  return (
    isMeaningfulTimestamp(info.storeCreated) ||
    isMeaningfulTimestamp(info.storeLastWrite) ||
    customDataEntries(info.customData).length > 0 ||
    !!info.path ||
    !!info.uri
  );
}
