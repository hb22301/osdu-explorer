# Why Reservoir ETP is not available

**Real ETP access is not implemented as a usable, verified feature in this
deployment.** Reservoir DDMS works over REST by default. The page includes a
per-session REST/ETP control and the API contains ETP route adapters, but neither
constitutes a working ETP integration without a loadable client and live
end-to-end verification.

## What blocks it

1. The required `@osdu/open-etp-client` package is not installed in this
   workspace and is not published on public npm. The [official Open ETP Client
   project](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-client)
   documents building it from source and packing a tarball; configuring an npm
   registry alone will not install it.
2. The upstream release examined for this project declares Node `>=12.16 <18`,
   while this workspace uses Node 24. Attempting to install its locked
   dependency tree also encountered packages blocked for critical
   vulnerabilities. We did not bypass the security policy or add an
   unbuildable dependency.
3. The ETP response conversions in `src/lib/etp-client.ts` are best-effort
   adapters to the existing REST response shapes. They have **not** been
   confirmed against a live ETP endpoint for dataspaces, records, arrays, edits,
   or deletes. Simply installing a client would not establish that these
   operations work correctly.

## Current behavior

- `GET /api/osdu/rdms/mode` reports `etpAvailable: false` when the client
  cannot be loaded. The page displays **ETP unavailable**, disables the
  switch, and continues to use REST.
- The server also rejects a direct attempt to select ETP when the client is
  unavailable. It does not silently pretend an ETP session was opened.
- The mode-toggle browser check uses mocked API responses; it verifies control
  behavior and unavailable-state handling, **not** connectivity to an ETP
  server.

## What is needed to enable it

Find or build a maintained client compatible with the project's Node runtime,
review its dependencies and native build requirements without bypassing
security protections, and install it reproducibly for development and
deployment. Then test session opening and every route adapter against a real
Reservoir ETP endpoint with representative data and permissions. Only after
those checks should ETP be described as supported. Until then, REST is the
supported way to access Reservoir DDMS.
