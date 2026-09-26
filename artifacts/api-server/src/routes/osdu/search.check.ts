import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import searchRouter from "./search";

const config = {
  baseUrl: "https://osdu-search-check.invalid",
  partitionId: "search-check",
  tokenEndpoint: "https://osdu-token-check.invalid/token",
  clientId: "search-check-client",
  clientSecret: "search-check-secret",
  scope: "search-check-scope",
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  Object.assign(req, { session: { osduConfig: config } });
  next();
});
app.use(searchRouter);

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});

const originalFetch = globalThis.fetch;
let forwardedBody: Record<string, unknown> | undefined;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === config.tokenEndpoint) {
    return new Response(JSON.stringify({ access_token: "search-check-token", expires_in: 3600 }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url === `${config.baseUrl}/api/search/v2/query`) {
    forwardedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ results: [], totalCount: 12_345 }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  return originalFetch(input, init);
};

try {
  const address = server.address() as AddressInfo;
  const response = await originalFetch(`http://127.0.0.1:${address.port}/osdu/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "osdu:wks:master-data--Well:1.0.0", limit: 0, trackTotalCount: true }),
  });

  assert.equal(response.status, 200, "the search route should accept accurate-count requests");
  assert.equal(forwardedBody?.trackTotalCount, true, "the route should forward the accurate-count option to OSDU");
  assert.equal(forwardedBody?.limit, 0, "the route should preserve the zero-result count query");
  console.log("OSDU search route forwards accurate-count requests.");
} finally {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}