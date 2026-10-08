import assert from "node:assert/strict";
import { parseStorageRecordResponse } from "../../lib/storage-record-response";

const record = parseStorageRecordResponse({
  id: "tenant:source:type--Well:1",
  kind: "osdu:wks:master-data--Well:1.0.0",
  version: 1,
  createUser: "creator@example.com",
  createTime: "2026-09-01T12:00:00.000Z",
  modifyUser: "editor@example.com",
  modifyTime: "2026-09-02T12:00:00.000Z",
  acl: { owners: ["owners@example.com"], viewers: [] },
  legal: {},
  data: { FacilityName: "Example well" },
  meta: [],
  ancestry: {},
  tags: {},
  providerSpecificTopLevelField: "still excluded",
});

assert.deepEqual(
  {
    createUser: record.createUser,
    createTime: record.createTime,
    modifyUser: record.modifyUser,
    modifyTime: record.modifyTime,
  },
  {
    createUser: "creator@example.com",
    createTime: "2026-09-01T12:00:00.000Z",
    modifyUser: "editor@example.com",
    modifyTime: "2026-09-02T12:00:00.000Z",
  },
);
assert.equal("providerSpecificTopLevelField" in record, false);

console.log("Storage record response preserves system fields and filters unspecified top-level fields.");
