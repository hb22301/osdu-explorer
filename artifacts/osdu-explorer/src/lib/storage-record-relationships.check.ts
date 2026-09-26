import assert from "node:assert/strict";
import {
  findRecordRelationships,
  looksLikeOsduRecordId,
  normalizeRecordId,
} from "./storage-record-relationships";

// Record ids carry the `--` group delimiter; kinds (trailing semver) do not qualify.
assert.equal(looksLikeOsduRecordId("osdu:master-data--Well:1111"), true);
assert.equal(looksLikeOsduRecordId("osdu:master-data--Well:1111:"), true);
assert.equal(looksLikeOsduRecordId("osdu:master-data--Well:1111:1633027200000"), true);
assert.equal(looksLikeOsduRecordId("osdu:wks:master-data--Well:1.0.0"), false); // a kind
assert.equal(looksLikeOsduRecordId("osdu-public-usa-dataset-1"), false); // a legal tag
assert.equal(looksLikeOsduRecordId("group@example.com"), false); // an ACL entry

// Trailing versions (bare colon or epoch) are stripped for navigation.
assert.equal(normalizeRecordId("osdu:master-data--Well:1111:"), "osdu:master-data--Well:1111");
assert.equal(normalizeRecordId("osdu:master-data--Well:1111:99"), "osdu:master-data--Well:1111");
assert.equal(normalizeRecordId("osdu:master-data--Well:1111"), "osdu:master-data--Well:1111");

const record = {
  id: "osdu:master-data--Well:1111",
  kind: "osdu:wks:master-data--Well:1.0.0",
  version: 999,
  acl: { owners: ["group@example.com"], viewers: [] },
  legal: { legaltags: ["osdu-public-usa-dataset-1"] },
  data: {
    WellID: "osdu:master-data--Well:1111:", // self-reference, must be skipped
    WellboreID: "osdu:master-data--Wellbore:2222:",
    SpatialLocationIDs: [
      "osdu:work-product-component--WellLog:3333",
      "osdu:work-product-component--WellLog:3333:5", // duplicate after normalization
    ],
    Name: "Just a name",
  },
  ancestry: { parents: ["osdu:master-data--Field:4444:2"] },
};

assert.deepEqual(findRecordRelationships(record), [
  { path: "data.WellboreID", id: "osdu:master-data--Wellbore:2222", raw: "osdu:master-data--Wellbore:2222:" },
  { path: "data.SpatialLocationIDs[0]", id: "osdu:work-product-component--WellLog:3333", raw: "osdu:work-product-component--WellLog:3333" },
  { path: "ancestry.parents[0]", id: "osdu:master-data--Field:4444", raw: "osdu:master-data--Field:4444:2" },
]);

// A record with no outbound references yields an empty list.
assert.deepEqual(
  findRecordRelationships({ id: "osdu:master-data--Well:9", kind: "osdu:wks:master-data--Well:1.0.0", data: { Name: "x" } }),
  [],
);

console.log("Storage record relationships detection check passed.");
