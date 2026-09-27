import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import rdmsRouter from "./rdms";

const config = {
  baseUrl: "https://rdms-dataspace-check.invalid",
  partitionId: "rdms-create-check",
  tokenEndpoint: "https://rdms-token-check.invalid/token",
  clientId: "rdms-create-check-client",
  clientSecret: "rdms-create-check-secret",
  scope: "rdms-create-check-scope",
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  Object.assign(req, {
    session: { osduConfig: config, rdmsMode: "rest" },
    sessionID: "rdms-dataspace-create-check",
  });
  next();
});
app.use(rdmsRouter);

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});

const originalFetch = globalThis.fetch;
let upstreamStatus = 201;
let upstreamResponse: unknown = { created: true };
let forwardedRequest: {
  url: string;
  method: string;
  partitionId: string | null;
  body: unknown;
} | null = null;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === config.tokenEndpoint) {
    return new Response(JSON.stringify({ access_token: "rdms-create-check-token", expires_in: 3600 }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url === `${config.baseUrl}/api/reservoir-ddms/v2/dataspaces`) {
    const headers = new Headers(init?.headers);
    forwardedRequest = {
      url,
      method: init?.method ?? "GET",
      partitionId: headers.get("data-partition-id"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    return new Response(JSON.stringify(upstreamResponse), {
      status: upstreamStatus,
      headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error(`Unexpected upstream URL: ${url}`);
};

try {
  const address = server.address() as AddressInfo;
  const requestPayload = [{
    DataspaceId: "dev/release_test",
    Path: "dev/release_test",
    CustomData: {
      legaltags: ["dev1-hal-test-dataset"],
      otherRelevantDataCountries: ["US"],
      owners: ["data.default.owners@dev1.dataservices.energy"],
      viewers: ["data.default.viewers@dev1.dataservices.energy"],
      "read-only": "false",
    },
  }];

  const response = await originalFetch(`http://127.0.0.1:${address.port}/osdu/rdms/dataspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload),
  });
  assert.equal(response.status, 201, "the proxy should preserve the Reservoir DDMS success status");
  assert.deepEqual(forwardedRequest, {
    url: `${config.baseUrl}/api/reservoir-ddms/v2/dataspaces`,
    method: "POST",
    partitionId: config.partitionId,
    body: requestPayload,
  }, "the proxy should forward the collection POST and the complete payload");

  upstreamStatus = 400;
  upstreamResponse = { message: "Invalid legal tag for this partition" };
  const failedResponse = await originalFetch(`http://127.0.0.1:${address.port}/osdu/rdms/dataspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload),
  });
  assert.equal(failedResponse.status, 400, "the proxy should preserve the upstream failure status");
  assert.deepEqual(await failedResponse.json(), {
    error: "Reservoir DDMS: Invalid legal tag for this partition",
  }, "the proxy should surface the upstream error detail");

  const callsBeforeInvalidBody = forwardedRequest;
  const invalidResponse = await originalFetch(`http://127.0.0.1:${address.port}/osdu/rdms/dataspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{}]),
  });
  assert.equal(invalidResponse.status, 400, "invalid registration payloads should be rejected locally");
  assert.deepEqual(forwardedRequest, callsBeforeInvalidBody, "invalid input must not reach Reservoir DDMS");
  console.log("Reservoir DDMS dataspace registration forwards the array payload and upstream errors.");
} finally {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}