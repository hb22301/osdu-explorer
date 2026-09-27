import assert from "node:assert/strict";
import { buildNewRecordTemplate, scaffoldDataFromSchema } from "./storage-record-new";

// A bare template (no schema) is the minimal valid, id-less envelope.
const bare = JSON.parse(buildNewRecordTemplate("osdu:wks:master-data--Well:1.0.0")) as Record<string, unknown>;
assert.equal(bare.kind, "osdu:wks:master-data--Well:1.0.0", "kind is carried through");
assert.equal("id" in bare, false, "a new-record template carries no id");
assert.deepEqual(bare.acl, { owners: [], viewers: [] }, "acl boilerplate is present");
assert.deepEqual(bare.legal, { legaltags: [], otherRelevantDataCountries: [] }, "legal boilerplate is present");
assert.deepEqual(bare.data, {}, "bare data is an empty object");

// Field order should read kind → acl → legal → data.
assert.deepEqual(
  Object.keys(bare),
  ["kind", "acl", "legal", "data"],
  "envelope fields are ordered for readability",
);

// Inline data properties are stubbed by type; $ref-only ones are skipped.
const schemaDoc = {
  kind: "osdu:wks:master-data--Well:1.0.0",
  schema: {
    properties: {
      id: { type: "string" },
      data: {
        properties: {
          FacilityName: { type: "string" },
          Count: { type: "integer" },
          Active: { type: "boolean" },
          Aliases: { type: "array", items: { type: "string" } },
          Nested: { type: "object" },
          RefField: { $ref: "osdu:wks:AbstractFacility:1.0.0" },
        },
      },
    },
  },
};
const scaffolded = JSON.parse(buildNewRecordTemplate("osdu:wks:master-data--Well:1.0.0", schemaDoc)) as {
  data: Record<string, unknown>;
};
assert.equal(scaffolded.data.FacilityName, "", "string fields stub to empty string");
assert.equal(scaffolded.data.Count, 0, "integer fields stub to 0");
assert.equal(scaffolded.data.Active, false, "boolean fields stub to false");
assert.deepEqual(scaffolded.data.Aliases, [], "array fields stub to []");
assert.deepEqual(scaffolded.data.Nested, {}, "object fields stub to {}");
assert.equal("RefField" in scaffolded.data, false, "$ref-only fields are skipped, not guessed");

// allOf fragments contribute their inline properties; $ref fragments do not.
const allOfData = scaffoldDataFromSchema({
  schema: {
    properties: {
      data: {
        allOf: [
          { $ref: "osdu:wks:AbstractCommonResources:1.0.0" },
          { properties: { SpecificField: { type: "string" } } },
        ],
      },
    },
  },
});
assert.equal(allOfData.SpecificField, "", "inline allOf fragment fields are stubbed");
assert.equal(Object.keys(allOfData).length, 1, "the $ref allOf fragment contributes nothing");

// A schema wholly behind $ref yields an empty data object, not a throw.
assert.deepEqual(
  scaffoldDataFromSchema({ schema: { properties: { data: { $ref: "x" } } } }),
  {},
  "a $ref-only data node scaffolds to empty",
);

// Missing / malformed schemas degrade to an empty data object.
assert.deepEqual(scaffoldDataFromSchema(undefined), {}, "undefined schema → empty data");
assert.deepEqual(scaffoldDataFromSchema({}), {}, "empty schema → empty data");
assert.deepEqual(scaffoldDataFromSchema({ schema: { properties: {} } }), {}, "no data node → empty data");

// A bare JSON-Schema body (not wrapped in a doc) is also accepted.
const bareBody = scaffoldDataFromSchema({ properties: { data: { properties: { N: { type: "number" } } } } });
assert.equal(bareBody.N, 0, "a bare schema body is accepted too");

console.log("storage-record-new check passed.");
