// Validates and builds the Reservoir DDMS registration payload, then creates it
// through the backend proxy (POST /api/osdu/rdms/dataspaces).
import { isIsoAlpha2CountryCode } from "./iso-countries";

export type NameValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export interface DataspaceMetadataDraft {
  legalTags: string;
  countries: string;
  owners: string;
  viewers: string;
  readOnly: boolean;
}

export interface DataspaceRegistration {
  DataspaceId: string;
  Path: string;
  CustomData: {
    legaltags: string[];
    otherRelevantDataCountries: string[];
    owners: string[];
    viewers: string[];
    "read-only": "true" | "false";
  };
}

export type DataspacePayloadValidation =
  | { ok: true; value: DataspaceRegistration[] }
  | { ok: false; error: string };

export function parseCommaSeparatedValues(raw: string): string[] {
  return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
}

export function buildDataspacePayload(
  name: string,
  draft: DataspaceMetadataDraft,
): DataspacePayloadValidation {
  const legalTags = parseCommaSeparatedValues(draft.legalTags);
  const countries = parseCommaSeparatedValues(draft.countries).map((country) => country.toUpperCase());
  const owners = parseCommaSeparatedValues(draft.owners);
  const viewers = parseCommaSeparatedValues(draft.viewers);

  if (legalTags.length === 0) return { ok: false, error: "Enter at least one legal tag." };
  if (countries.length === 0) return { ok: false, error: "Enter at least one other relevant data country." };
  const invalidCountries = countries.filter((country) => !isIsoAlpha2CountryCode(country));
  if (invalidCountries.length > 0) {
    return {
      ok: false,
      error: `Use assigned ISO alpha-2 country codes (for example, US). Invalid: ${invalidCountries.join(", ")}`,
    };
  }
  if (owners.length === 0) return { ok: false, error: "Enter at least one owner group." };

  return {
    ok: true,
    value: [{
      DataspaceId: name,
      Path: name,
      CustomData: {
        legaltags: legalTags,
        otherRelevantDataCountries: countries,
        owners,
        viewers,
        "read-only": draft.readOnly ? "true" : "false",
      },
    }],
  };
}

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

export async function createDataspace(
  payload: DataspaceRegistration[],
  signal?: AbortSignal,
): Promise<DataspaceCreateResult> {
  try {
    const response = await fetch("/api/osdu/rdms/dataspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        detail?: string;
      } | null;
      return {
        ok: false,
        error: body?.error ?? body?.message ?? body?.detail ?? `Failed to create dataspace (HTTP ${response.status})`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not connect to Reservoir DDMS.",
    };
  }
}
