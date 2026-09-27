// Pure, framework-free helpers for reading, editing and validating a Storage
// record's Access Control List. The ACL is `{ owners: [], viewers: [] }` where
// each entry is an Entitlements group email such as
// `data.default.owners@opendes.dataservices.energy`. Kept dependency-free so it
// can run under the unit checks (and stay Replit-safe — no `three`).

export type AclRole = "owners" | "viewers";

export interface Acl {
  owners: string[];
  viewers: string[];
}

export interface AclValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// A group email: a dotted local part, then `@`, then a dotted domain with a TLD.
const GROUP_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
}

// Read the ACL from a record, tolerating a missing or malformed `acl` object.
export function getAcl(record: unknown): Acl {
  const acl = (record && typeof record === "object" ? (record as Record<string, unknown>).acl : undefined) as
    | Record<string, unknown>
    | undefined;
  return {
    owners: toStringArray(acl?.owners),
    viewers: toStringArray(acl?.viewers),
  };
}

// Return a shallow copy of the record with its ACL replaced. The lists are
// de-duplicated so repeated saves stay idempotent. Never mutates the input.
export function withAcl(record: unknown, next: Acl): Record<string, unknown> {
  const base = record && typeof record === "object" && !Array.isArray(record)
    ? { ...(record as Record<string, unknown>) }
    : {};
  base.acl = {
    owners: dedupe(next.owners),
    viewers: dedupe(next.viewers),
  };
  return base;
}

export function isValidGroup(group: string): boolean {
  return GROUP_RE.test(group.trim());
}

function dedupe(groups: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    const trimmed = g.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// Add a group to a role list. Returns a new ACL; a blank, invalid or duplicate
// group leaves the list unchanged.
export function addGroup(acl: Acl, role: AclRole, group: string): Acl {
  const trimmed = group.trim();
  if (!isValidGroup(trimmed) || acl[role].includes(trimmed)) return acl;
  return { ...acl, [role]: [...acl[role], trimmed] };
}

// Remove a group from a role list. Returns a new ACL.
export function removeGroup(acl: Acl, role: AclRole, group: string): Acl {
  return { ...acl, [role]: acl[role].filter((g) => g !== group) };
}

// Validate an ACL before saving. `myGroups`, when supplied, is the set of group
// emails the caller belongs to — used to warn about locking yourself out.
export function validateAcl(acl: Acl, myGroups?: string[]): AclValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (acl.owners.length === 0) {
    errors.push("A record must have at least one owner group.");
  }

  const invalid = [...acl.owners, ...acl.viewers].filter((g) => !isValidGroup(g));
  for (const g of invalid) {
    errors.push(`"${g}" is not a valid group email.`);
  }

  if (myGroups && myGroups.length > 0) {
    const mine = new Set(myGroups);
    const stillIncluded = [...acl.owners, ...acl.viewers].some((g) => mine.has(g));
    if (!stillIncluded) {
      warnings.push("None of the groups you belong to are on this ACL — you may lose access to this record after saving.");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// True when two ACLs hold the same groups in the same order — used to gate the
// "Save" button on real edits.
export function aclEquals(a: Acl, b: Acl): boolean {
  return arraysEqual(a.owners, b.owners) && arraysEqual(a.viewers, b.viewers);
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
