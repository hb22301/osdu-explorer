import assert from "node:assert/strict";
import {
  getAcl,
  withAcl,
  isValidGroup,
  addGroup,
  removeGroup,
  validateAcl,
  aclEquals,
  type Acl,
} from "./record-acl";

const OWNER = "data.default.owners@opendes.dataservices.energy";
const VIEWER = "data.default.viewers@opendes.dataservices.energy";

// getAcl reads owners/viewers and tolerates malformed input.
assert.deepEqual(getAcl({ acl: { owners: [OWNER], viewers: [VIEWER] } }), {
  owners: [OWNER],
  viewers: [VIEWER],
});
assert.deepEqual(getAcl({}), { owners: [], viewers: [] });
assert.deepEqual(getAcl({ acl: { owners: "nope", viewers: [VIEWER, 5, "  "] } }), {
  owners: [],
  viewers: [VIEWER],
});
assert.deepEqual(getAcl(null), { owners: [], viewers: [] });
// Whitespace is trimmed off entries.
assert.deepEqual(getAcl({ acl: { owners: [`  ${OWNER}  `] } }).owners, [OWNER]);

// withAcl is immutable, replaces the acl, dedupes, and preserves other fields.
const record = { id: "r1", kind: "k", data: { A: 1 }, acl: { owners: [], viewers: [] } };
const updated = withAcl(record, { owners: [OWNER, OWNER], viewers: [] });
assert.deepEqual(updated.acl, { owners: [OWNER], viewers: [] });
assert.deepEqual((updated.data as Record<string, unknown>), { A: 1 });
assert.deepEqual(record.acl, { owners: [], viewers: [] }, "input record must not be mutated");

// isValidGroup.
assert.equal(isValidGroup(OWNER), true);
assert.equal(isValidGroup("data.default.owners@opendes.dataservices.energy"), true);
assert.equal(isValidGroup("users@opendes.example.com"), true);
assert.equal(isValidGroup("not-an-email"), false);
assert.equal(isValidGroup("missing@tld"), false);
assert.equal(isValidGroup(""), false);
assert.equal(isValidGroup("  "), false);

// addGroup: valid + non-duplicate only; immutable.
const a0: Acl = { owners: [OWNER], viewers: [] };
assert.deepEqual(addGroup(a0, "viewers", VIEWER), { owners: [OWNER], viewers: [VIEWER] });
assert.equal(addGroup(a0, "owners", OWNER), a0, "duplicate is a no-op (same ref)");
assert.equal(addGroup(a0, "viewers", "bad"), a0, "invalid is a no-op (same ref)");
assert.deepEqual(a0, { owners: [OWNER], viewers: [] }, "addGroup must not mutate");

// removeGroup: immutable.
assert.deepEqual(removeGroup({ owners: [OWNER], viewers: [VIEWER] }, "viewers", VIEWER), {
  owners: [OWNER],
  viewers: [],
});

// validateAcl: at-least-one-owner lockout guard.
assert.equal(validateAcl({ owners: [OWNER], viewers: [] }).valid, true);
const noOwners = validateAcl({ owners: [], viewers: [VIEWER] });
assert.equal(noOwners.valid, false);
assert.ok(noOwners.errors.some((e) => e.includes("at least one owner")));

// validateAcl: invalid group format is an error.
const badGroup = validateAcl({ owners: [OWNER, "junk"], viewers: [] });
assert.equal(badGroup.valid, false);
assert.ok(badGroup.errors.some((e) => e.includes("junk")));

// validateAcl: lock-yourself-out warning (not an error).
const lockout = validateAcl({ owners: [OWNER], viewers: [] }, ["data.other.owners@opendes.dataservices.energy"]);
assert.equal(lockout.valid, true);
assert.equal(lockout.warnings.length, 1);
const stillIn = validateAcl({ owners: [OWNER], viewers: [] }, [OWNER]);
assert.equal(stillIn.warnings.length, 0);

// aclEquals is order-sensitive.
assert.equal(aclEquals({ owners: [OWNER], viewers: [] }, { owners: [OWNER], viewers: [] }), true);
assert.equal(aclEquals({ owners: [OWNER], viewers: [] }, { owners: [], viewers: [OWNER] }), false);
assert.equal(aclEquals({ owners: [OWNER, VIEWER], viewers: [] }, { owners: [VIEWER, OWNER], viewers: [] }), false);

console.log("record-acl check passed.");
