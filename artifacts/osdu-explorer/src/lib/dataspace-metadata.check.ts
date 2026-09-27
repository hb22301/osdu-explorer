import assert from "node:assert/strict";
import {
  customDataEntries,
  extractDataspaceName,
  hasDisplayableMetadata,
  isMeaningfulTimestamp,
  parseDataspaceList,
} from "./dataspace-metadata";

// Pulls the name out of an eml:/// dataspace URI, or passes plain names through.
assert.equal(extractDataspaceName("eml:///dataspace('PDS-Preview/CWP')"), "PDS-Preview/CWP");
assert.equal(extractDataspaceName("demo/space"), "demo/space");

// REST returns an array of dataspace objects; metadata is preserved, not dropped.
const rest = parseDataspaceList([
  {
    name: "PDS-Preview/CWP",
    path: "PDS-Preview/CWP",
    uri: "eml:///dataspace('PDS-Preview/CWP')",
    storeCreated: "2024-05-01T10:00:00.000Z",
    storeLastWrite: "2024-06-02T12:30:00.000Z",
    customData: { legaltags: "dev1-hal-test", "read-only": "false" },
  },
]);
assert.equal(rest.length, 1);
assert.equal(rest[0].name, "PDS-Preview/CWP");
assert.equal(rest[0].path, "PDS-Preview/CWP");
assert.equal(rest[0].storeCreated, "2024-05-01T10:00:00.000Z");
assert.deepEqual(rest[0].customData, { legaltags: "dev1-hal-test", "read-only": "false" });

// The { dataspaces: [...] } wrapper (ETP proxy) with bare strings still parses.
const etpStrings = parseDataspaceList({ dataspaces: ["demo", "eml:///dataspace('other')"] });
assert.deepEqual(etpStrings.map((d) => d.name), ["demo", "other"]);

// The { data: [...] } wrapper is also accepted; name falls back to uri.
const wrapped = parseDataspaceList({ data: [{ uri: "eml:///dataspace('from/uri')" }] });
assert.equal(wrapped[0].name, "from/uri");

// Non-string customData values are stringified so they remain displayable.
const coerced = parseDataspaceList([{ name: "x", customData: { owners: ["a@b.com"], count: 3 } }]);
assert.deepEqual(coerced[0].customData, { owners: '["a@b.com"]', count: "3" });

// Epoch-zero timestamps mean "no recorded time" and are treated as meaningless.
assert.equal(isMeaningfulTimestamp("1970-01-01T00:00:00.000Z"), false);
assert.equal(isMeaningfulTimestamp("0001-01-01T00:00:00.000Z"), false);
assert.equal(isMeaningfulTimestamp(""), false);
assert.equal(isMeaningfulTimestamp(undefined), false);
assert.equal(isMeaningfulTimestamp("not-a-date"), false);
assert.equal(isMeaningfulTimestamp("2024-05-01T10:00:00.000Z"), true);

// customDataEntries drops blank keys and preserves the rest.
assert.deepEqual(customDataEntries({ a: "1", "": "skip", b: "2" }), [["a", "1"], ["b", "2"]]);
assert.deepEqual(customDataEntries(undefined), []);

// A name-only dataspace has nothing extra to surface; metadata-bearing ones do.
assert.equal(hasDisplayableMetadata({ name: "bare" }), false);
assert.equal(hasDisplayableMetadata({ name: "bare", storeLastWrite: "1970-01-01T00:00:00.000Z" }), false);
assert.equal(hasDisplayableMetadata(rest[0]), true);
assert.equal(hasDisplayableMetadata({ name: "x", customData: { k: "v" } }), true);

console.log("dataspace-metadata check passed.");
