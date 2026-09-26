import assert from "node:assert/strict";
import { parseOsduSchemaResponse } from "./schema";

const kind = "osdu:wks:master-data--Wellbore:1.5.1";
const response = {
  schemaIdentity: {
    id: kind,
    authority: "osdu",
    source: "wks",
  },
  status: "PUBLISHED",
  dataType: "QuantitativeAccuracyBand",
  GroupType: "reference-data",
  pattern: "^wellbore$",
  customMetadata: {
    providerField: "retained",
  },
  schema: {
    properties: {
      Wellbore: {
        type: "object",
        properties: {
          Trajectory: {
            type: "string",
            description: "complete-schema-definition-visible",
          },
        },
      },
    },
  },
};

assert.deepEqual(parseOsduSchemaResponse(response, "fallback-kind"), {
  ...response,
  kind,
});

assert.equal(
  parseOsduSchemaResponse({ id: "provider:custom:1.0.0", dataType: "custom" }, "fallback-kind").kind,
  "provider:custom:1.0.0",
);
assert.equal(
  parseOsduSchemaResponse({ dataType: "custom" }, "fallback-kind").kind,
  "fallback-kind",
);

console.log("OSDU schema response preserves arbitrary top-level fields.");