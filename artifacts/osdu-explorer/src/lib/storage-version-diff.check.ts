import assert from "node:assert/strict";
import {
  diffRecords,
  summarizeChanges,
  isSystemFieldChange,
} from "./storage-version-diff";

const base = {
  id: "osdu:master-data--Well:1111",
  version: 1000,
  modifyTime: "2025-01-01T00:00:00Z",
  data: {
    Name: "Alpha",
    SpudDate: "2020-05-01",
    Markers: [{ Name: "Top", MD: 100 }, { Name: "Base", MD: 200 }],
    GeoContexts: [{ BasinID: "b-1" }],
  },
};

const target = {
  id: "osdu:master-data--Well:1111",
  version: 1001,
  modifyTime: "2025-02-02T00:00:00Z",
  data: {
    // Name unchanged; keys reordered to prove order-insensitivity.
    Markers: [{ MD: 105, Name: "Top" }, { Name: "Base", MD: 200 }],
    Name: "Alpha",
    Operator: "NewCo", // added
    GeoContexts: [], // element removed
  },
};

const changes = diffRecords(base, target);
const byPath = new Map(changes.map((c) => [c.path, c]));

// Changed leaf value.
assert.deepEqual(byPath.get("data.Markers[0].MD"), {
  path: "data.Markers[0].MD",
  kind: "changed",
  before: 100,
  after: 105,
});
// Added field carries only the new value.
assert.deepEqual(byPath.get("data.Operator"), {
  path: "data.Operator",
  kind: "added",
  after: "NewCo",
});
// Removed array element carries only the old value.
assert.deepEqual(byPath.get("data.GeoContexts[0]"), {
  path: "data.GeoContexts[0]",
  kind: "removed",
  before: { BasinID: "b-1" },
});
// System-field bumps are reported too (grouped separately in the UI).
assert.ok(byPath.has("version"));
assert.ok(byPath.has("modifyTime"));

// Reordered-but-equal object keys and unchanged values produce no change.
assert.equal(byPath.has("data.Name"), false);
assert.equal(byPath.has("data.SpudDate"), true); // removed in target
assert.deepEqual(byPath.get("data.SpudDate")?.kind, "removed");
assert.equal(byPath.has("data.Markers[1].MD"), false);

// Identical records diff to nothing.
assert.deepEqual(diffRecords(base, base), []);

// Summary counts line up with the change list.
const summary = summarizeChanges(changes);
assert.equal(summary.total, changes.length);
assert.equal(summary.added + summary.removed + summary.changed, summary.total);

// System vs data classification.
assert.equal(isSystemFieldChange({ path: "version", kind: "changed" }), true);
assert.equal(isSystemFieldChange({ path: "modifyTime", kind: "changed" }), true);
assert.equal(isSystemFieldChange({ path: "meta[0].kind", kind: "changed" }), true);
assert.equal(isSystemFieldChange({ path: "data.Operator", kind: "added" }), false);

// Type changes (object ↔ primitive) report the whole value as changed.
const typeChange = diffRecords({ a: { x: 1 } }, { a: 5 });
assert.deepEqual(typeChange, [{ path: "a", kind: "changed", before: { x: 1 }, after: 5 }]);

console.log("storage-version-diff check passed.");
