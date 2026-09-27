export interface LegalConstraintsDraft {
  legalTags: string[];
  countries: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export function getLegalConstraints(record: unknown): LegalConstraintsDraft {
  const legal = asRecord(asRecord(record).legal);
  return {
    legalTags: stringArray(legal.legaltags),
    countries: stringArray(legal.otherRelevantDataCountries).map((country) => country.toUpperCase()),
  };
}

export function legalConstraintsEqual(left: LegalConstraintsDraft, right: LegalConstraintsDraft): boolean {
  return left.legalTags.length === right.legalTags.length
    && left.legalTags.every((value, index) => value === right.legalTags[index])
    && left.countries.length === right.countries.length
    && left.countries.every((value, index) => value === right.countries[index]);
}

export function withLegalConstraints(record: unknown, draft: LegalConstraintsDraft): Record<string, unknown> {
  const original = asRecord(record);
  const originalLegal = asRecord(original.legal);
  return {
    ...original,
    legal: {
      ...originalLegal,
      legaltags: [...draft.legalTags],
      otherRelevantDataCountries: [...draft.countries],
    },
  };
}