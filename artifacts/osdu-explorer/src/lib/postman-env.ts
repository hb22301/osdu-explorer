export type PostmanEnvironmentValue = {
  key?: string;
  value?: string;
  enabled?: boolean;
};

export type PostmanEnvironment = {
  values?: PostmanEnvironmentValue[];
};

export function parsePostmanEnvironment(text: string): PostmanEnvironment {
  const withoutBom = text.replace(/^\uFEFF/, "").trimStart();
  const objectStart = withoutBom.indexOf("{");
  if (objectStart < 0) {
    throw new Error("The file does not contain a Postman environment JSON object.");
  }

  const parsed = JSON.parse(withoutBom.slice(objectStart)) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("The file does not contain a valid Postman environment object.");
  }

  const environment = parsed as { values?: unknown };
  if (environment.values !== undefined && !Array.isArray(environment.values)) {
    throw new Error("The Postman environment values field is not an array.");
  }

  return parsed as PostmanEnvironment;
}

export function resolvePostmanVariables(
  entries: readonly PostmanEnvironmentValue[],
): Map<string, string> {
  const rawValues = new Map<string, string>();
  for (const entry of entries) {
    if (typeof entry.key === "string" && entry.key.trim() && typeof entry.value === "string") {
      rawValues.set(entry.key, entry.value);
    }
  }

  const resolvedValues = new Map<string, string>();
  const resolving = new Set<string>();

  const resolveVariable = (name: string): string => {
    const cached = resolvedValues.get(name);
    if (cached !== undefined) return cached;

    const rawValue = rawValues.get(name);
    if (rawValue === undefined) return `{{${name}}}`;
    if (resolving.has(name)) return `{{${name}}}`;

    resolving.add(name);
    const resolved = rawValue.replace(/\{\{([^{}]+)\}\}/g, (token, tokenName: string) => {
      const referencedName = tokenName.trim();
      return rawValues.has(referencedName) ? resolveVariable(referencedName) : token;
    });
    resolving.delete(name);
    resolvedValues.set(name, resolved);
    return resolved;
  };

  for (const name of rawValues.keys()) {
    resolveVariable(name);
  }

  return resolvedValues;
}