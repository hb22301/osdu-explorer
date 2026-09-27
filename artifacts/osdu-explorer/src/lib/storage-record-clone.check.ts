import assert from "node:assert/strict";
import { createStorageRecords, prepareRecordClone } from "./storage-record-clone";

// A full storage record clones down to a create-ready body: the server-managed
// identity fields are stripped, the payload (kind/acl/legal/data) is kept.
const original = JSON.stringify({
  id: "tenant:master-data--Well:abc",
  kind: "osdu:wks:master-data--Well:1.0.0",
  version: 12,
  createUser: "alice@example.com",
  createTime: "2024-01-01T00:00:00.000Z",
  modifyUser: "bob@example.com",
  modifyTime: "2024-02-01T00:00:00.000Z",
  ancestry: { parents: ["x"] },
  acl: { owners: ["o@t"], viewers: ["v@t"] },
  legal: { legaltags: ["t"] },
  data: { FacilityName: "Well 1" },
});
const prepared = prepareRecordClone(original);
assert.ok(prepared.ok, "a valid record should prepare");
const cloned = JSON.parse(prepared.value) as Record<string, unknown>;
for (const field of ["id", "version", "createUser", "createTime", "modifyUser", "modifyTime", "ancestry"]) {
  assert.equal(field in cloned, false, `${field} must be stripped from a clone`);
}
assert.equal(cloned.kind, "osdu:wks:master-data--Well:1.0.0", "kind is preserved");
assert.deepEqual(cloned.data, { FacilityName: "Well 1" }, "data payload is preserved");
assert.deepEqual(cloned.acl, { owners: ["o@t"], viewers: ["v@t"] }, "acl is preserved");

// An array of records clones each element and stays an array.
const arr = prepareRecordClone(JSON.stringify([{ id: "a", data: { n: 1 } }, { id: "b", data: { n: 2 } }]));
assert.ok(arr.ok);
const arrParsed = JSON.parse(arr.value) as Record<string, unknown>[];
assert.equal(Array.isArray(arrParsed), true, "array shape is preserved");
assert.equal("id" in arrParsed[0], false, "array elements are stripped too");
assert.deepEqual(arrParsed[1].data, { n: 2 });

// Invalid JSON is reported, not thrown.
const bad = prepareRecordClone("{ not json");
assert.equal(bad.ok, false, "invalid JSON must return an error");

// createStorageRecords PUTs an array, strips response-only fields, and surfaces
// the returned record ids.
let captured: { url: string; method: string; body: unknown } | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
  captured = {
    url: String(input),
    method: init?.method ?? "GET",
    body: JSON.parse(init?.body ?? "null"),
  };
  return {
    ok: true,
    status: 200,
    json: async () => ({ recordCount: 1, recordIds: ["tenant:master-data--Well:new-id"] }),
  } as Response;
}) as typeof fetch;

const steps: string[] = [];
const created = await createStorageRecords(
  [{ kind: "k", acl: {}, legal: {}, data: { n: 1 }, meta: [], ancestry: {}, tags: {} }],
  (s) => steps.push(s),
);
globalThis.fetch = realFetch;

assert.ok(created.ok, "a create should succeed");
assert.deepEqual(created.recordIds, ["tenant:master-data--Well:new-id"], "returned ids are surfaced");
assert.ok(steps.length > 0, "progress steps are reported");
assert.equal(captured!.method, "PUT", "create uses PUT");
assert.match(captured!.url, /\/api\/osdu\/records$/, "create targets the records endpoint");
const sent = captured!.body as Record<string, unknown>[];
assert.equal(Array.isArray(sent), true, "create sends an array");
assert.equal("meta" in sent[0], false, "response-only meta is stripped");
assert.equal("ancestry" in sent[0], false, "response-only ancestry is stripped");
assert.equal("tags" in sent[0], false, "response-only tags is stripped");
assert.equal("id" in sent[0], false, "a create body carries no id");

// An empty list is rejected before any request.
const empty = await createStorageRecords([]);
assert.equal(empty.ok, false, "an empty create is rejected");

console.log("storage-record-clone check passed.");
