# Reservoir DDMS: REST / ETP toggle

The Reservoir DDMS (RDDMS) page can talk to the backend over **REST** (default) or
**ETP** (Energistics Transfer Protocol, a WebSocket + Avro binary protocol). A
per-session switch in the Reservoir page top bar flips between them; the frontend
contract is identical, so only the api-server changes behaviour.

## Pulling and running (REST works out of the box)

```bash
git pull
pnpm install          # no new deps vs. the previous commit
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/osdu-explorer run dev
```

Everything works immediately in **REST** mode. You can also flip the switch to
**ETP**: because the ETP client library is not installed by default (see below),
the server returns a clear *"ETP client library is not installed"* error and the
switch snaps back to REST. That is the expected graceful-degradation path and is
enough to validate the toggle wiring end-to-end.

Run the toggle browser check (mocked, no backend needed):

```bash
pnpm --filter @workspace/osdu-explorer run check:reservoir-mode-toggle-browser
```

## Enabling real ETP (optional, manual)

ETP mode only does real work once `@osdu/open-etp-client` is installed. It is
**not on public npm** and pulls native builds, so this is a deliberate opt-in:

1. Configure the OSDU GitLab package registry + an auth token in `.npmrc`, e.g.:
   ```
   @osdu:registry=https://community.opengroup.org/api/v4/projects/<id>/packages/npm/
   //community.opengroup.org/api/v4/projects/<id>/packages/npm/:_authToken=${OSDU_NPM_TOKEN}
   ```
2. `pnpm add @osdu/open-etp-client` in `artifacts/api-server` and commit the
   updated `pnpm-lock.yaml` in the same change.
3. Make the native deps build (Node >= 22 — Replit `nodejs-24` is fine):
   `libxmljs2` (node-gyp) and `h5wasm` (WASM). These are the main install risk
   under Replit/Nix.
4. `build.mjs` already externalizes `@osdu/open-etp-client`, `libxmljs2`, and
   `h5wasm`, so the bundle picks them up at runtime once installed.

No configuration secrets are stored in the repo. OSDU connection details
(base URL, token endpoint, client id/secret, scope, partition) are entered in the
app's config UI at runtime; the ETP WebSocket URL is derived automatically from
the base URL (`https://host/...` -> `wss://host/api/reservoir-ddms-etp/v2/`).

## Known caveat

The ETP result shapers in `src/lib/etp-client.ts` normalise `ResqmlClient`
responses to match the REST JSON shapes, but are **best effort** until validated
against a live ETP session. Validate with a standalone `getDataspaces()` spike
before trusting ETP mode for real data.
