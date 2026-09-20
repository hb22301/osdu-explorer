export type ConsoleEntryType = "token_fetch" | "api_request" | "error";
export type ConsoleEntryLevel = "info" | "warn" | "error";

export interface ConsoleEntry {
  id: string;
  timestamp: string;
  type: ConsoleEntryType;
  level: ConsoleEntryLevel;
  method: string | null;
  url: string | null;
  requestHeaders: Record<string, string> | null;
  requestBody: unknown | null;
  responseStatus: number | null;
  responseHeaders: Record<string, string> | null;
  responseBody: unknown | null;
  durationMs: number | null;
  responseSize: number | null;
  recordCount: number | null;
  pending: boolean;
  message: string | null;
}

const MAX_ENTRIES = 250;
const MAX_CAPTURED_PAYLOAD_BYTES = 32 * 1024;
const entries: ConsoleEntry[] = [];
let counter = 0;

function trimPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === "string") {
    return payload.length <= MAX_CAPTURED_PAYLOAD_BYTES
      ? payload
      : `${payload.slice(0, MAX_CAPTURED_PAYLOAD_BYTES)}\n… [truncated]`;
  }

  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length <= MAX_CAPTURED_PAYLOAD_BYTES) return payload;
    return `${serialized.slice(0, MAX_CAPTURED_PAYLOAD_BYTES)}\n… [truncated]`;
  } catch {
    return "[unavailable: payload could not be serialized]";
  }
}

function trimEntryPayloads<T extends { requestBody: unknown | null; responseBody: unknown | null }>(entry: T): T {
  return {
    ...entry,
    requestBody: trimPayload(entry.requestBody),
    responseBody: trimPayload(entry.responseBody),
  };
}

function nextId(): string {
  counter += 1;
  return String(counter);
}

export function addEntry(entry: Omit<ConsoleEntry, "id" | "timestamp">): ConsoleEntry {
  const full: ConsoleEntry = trimEntryPayloads({
    ...entry,
    id: nextId(),
    timestamp: new Date().toISOString(),
  });
  entries.push(full);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  return full;
}

export function updateEntry(
  id: string,
  updates: Partial<Omit<ConsoleEntry, "id" | "timestamp">>
): void {
  let idx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].id === id) { idx = i; break; }
  }
  if (idx !== -1) {
    entries[idx] = trimEntryPayloads({ ...entries[idx], ...updates });
  }
}

export function getEntries(limit = 200, offset = 0): { entries: ConsoleEntry[]; total: number } {
  const total = entries.length;
  const end = Math.max(0, total - offset);
  const slice = entries.slice(Math.max(0, end - limit), end);
  return { entries: slice, total };
}

export function clearEntries(): void {
  entries.splice(0, entries.length);
}
