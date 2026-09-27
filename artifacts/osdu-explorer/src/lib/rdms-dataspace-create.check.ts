import assert from "node:assert/strict";
import { validateDataspaceName } from "./rdms-dataspace-create";

// Accepts a simple name and a multi-segment path; trims surrounding whitespace.
assert.deepEqual(validateDataspaceName("demo"), { ok: true, value: "demo" });
assert.deepEqual(validateDataspaceName("PDS-Preview/Agentic_CWP"), {
  ok: true,
  value: "PDS-Preview/Agentic_CWP",
});
assert.deepEqual(validateDataspaceName("  spaced.name-1  "), { ok: true, value: "spaced.name-1" });

// Empty / whitespace-only → rejected.
assert.equal(validateDataspaceName("").ok, false);
assert.equal(validateDataspaceName("   ").ok, false);

// Internal spaces → rejected with the spaces message.
const spaced = validateDataspaceName("has space");
assert.equal(spaced.ok, false);
assert.equal(spaced.ok === false && spaced.error.includes("spaces"), true);

// Leading / trailing slash and empty segments → rejected.
assert.equal(validateDataspaceName("/leading").ok, false);
assert.equal(validateDataspaceName("trailing/").ok, false);
assert.equal(validateDataspaceName("a//b").ok, false);

// Illegal characters → rejected.
assert.equal(validateDataspaceName("bad*name").ok, false);
assert.equal(validateDataspaceName("bad name!").ok, false);

// Duplicate (exact match against existing) → rejected.
const dup = validateDataspaceName("demo", ["other", "demo"]);
assert.equal(dup.ok, false);
assert.equal(dup.ok === false && dup.error.includes("already exists"), true);

// Not a duplicate when case differs (RDDMS names are case-sensitive).
assert.equal(validateDataspaceName("Demo", ["demo"]).ok, true);

console.log("rdms-dataspace-create check passed.");
