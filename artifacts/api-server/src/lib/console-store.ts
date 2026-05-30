export type ConsoleEntryType = "token_fetch" | "api_request" | "error";
export type ConsoleEntryLevel = "info" | "warn" | "error";

export interface ConsoleEntry {
  id: string;
  timestamp: string;
  type: ConsoleEntryType;
  level: ConsoleEntryLevel;
  method: string | null;
  url: string | null;
  requestBody: unknown | null;
  responseStatus: number | null;
  responseBody: unknown | null;
  durationMs: number | null;
  message: string | null;
}

const MAX_ENTRIES = 500;
const entries: ConsoleEntry[] = [];
let counter = 0;

function nextId(): string {
  counter += 1;
  return String(counter);
}

export function addEntry(entry: Omit<ConsoleEntry, "id" | "timestamp">): ConsoleEntry {
  const full: ConsoleEntry = {
    ...entry,
    id: nextId(),
    timestamp: new Date().toISOString(),
  };
  entries.push(full);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  return full;
}

export function getEntries(limit = 200, offset = 0): { entries: ConsoleEntry[]; total: number } {
  const total = entries.length;
  const slice = entries.slice(offset, offset + limit);
  return { entries: slice, total };
}

export function clearEntries(): void {
  entries.splice(0, entries.length);
}
