import { getAccessToken, type OsduConfig } from "./osdu-client";
import { logger } from "./logger";
import { parseObjectUri, extractTransactionId } from "./rdms-uri";

// @osdu/open-etp-client is loaded lazily through a computed specifier so the
// api-server still type-checks and runs in REST mode when the package is not
// installed. The package lives in the OSDU GitLab registry (not public npm) and
// pulls native builds (libxmljs2, h5wasm), so it is an opt-in dependency: ETP
// mode only works once it has been installed and the session is switched to it.
const ETP_MODULE_SPECIFIER = "@osdu/open-etp-client";

// The ETP subset the routes rely on. Typed loosely because the real types ship
// with the (optional) package; shapes returned below are normalised to match
// the existing REST responses so the frontend contract stays identical.
interface ResqmlClientLike {
  openSession(url: string, jwToken?: string, dataPartitionId?: string): Promise<unknown>;
  closeSession(): Promise<unknown>;
  isConnected(): boolean;
  getDataspaces(): Promise<unknown>;
  getResources(context?: unknown, scope?: unknown, types?: string[]): Promise<unknown>;
  getDataObjects(uris: string[]): Promise<unknown>;
  getDataArray(uri: string, pathInResource: string): Promise<unknown>;
  putDataObjects(objects: unknown, transactionId?: string): Promise<unknown>;
  deleteObjects(uris: string[], transactionId?: string): Promise<unknown>;
  startTransaction(readOnly: boolean, dataspaces: string[], message?: string): Promise<unknown>;
  commitTransaction(uuid: string): Promise<unknown>;
  rollbackTransaction(uuid: string): Promise<unknown>;
}

interface SessionEntry {
  client: ResqmlClientLike;
  cacheKey: string;
  lastUsed: number;
}

const sessions = new Map<string, SessionEntry>();
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
let etpAvailabilityPromise: Promise<boolean> | undefined;

// Derives the ETP WebSocket URL from the REST base URL: swap the scheme to wss
// and target the ETP path variant. e.g.
// https://host -> wss://host/api/reservoir-ddms-etp/v2/
export function deriveEtpUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const wss = trimmed.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${wss}/api/reservoir-ddms-etp/v2/`;
}

// Builds the Energistics object URI the ETP calls address, matching the form the
// REST bridge uses internally: eml:///dataspace('ds')/type(uuid)
function objectUri(dataspace: string, datatype: string, uuid: string): string {
  return `eml:///dataspace('${dataspace}')/${datatype}(${uuid})`;
}

function configCacheKey(cfg: OsduConfig, etpUrl: string): string {
  return `${etpUrl}|${cfg.partitionId}|${cfg.clientId}`;
}

async function loadResqmlClient(): Promise<ResqmlClientLike> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(ETP_MODULE_SPECIFIER)) as Record<string, unknown>;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `ETP client library is not installed. Install @osdu/open-etp-client to use ETP mode. (${detail})`,
    );
  }
  const defaultExport = mod.default as Record<string, unknown> | undefined;
  const ResqmlClient = (mod.ResqmlClient ?? defaultExport?.ResqmlClient) as
    | (new () => ResqmlClientLike)
    | undefined;
  if (!ResqmlClient) throw new Error("ETP client module did not export ResqmlClient");
  return new ResqmlClient();
}

export function isEtpClientAvailable(): Promise<boolean> {
  etpAvailabilityPromise ??= import(ETP_MODULE_SPECIFIER)
    .then(() => true)
    .catch(() => false);
  return etpAvailabilityPromise;
}

// Returns a connected ResqmlClient for the session, opening (or reopening) the
// session lazily and reusing the same cached token REST already uses.
export async function getEtpClient(sessionId: string, cfg: OsduConfig): Promise<ResqmlClientLike> {
  const etpUrl = cfg.etpUrl ?? deriveEtpUrl(cfg.baseUrl);
  const key = configCacheKey(cfg, etpUrl);

  const existing = sessions.get(sessionId);
  if (existing && existing.cacheKey === key && existing.client.isConnected()) {
    existing.lastUsed = Date.now();
    return existing.client;
  }
  if (existing) {
    await existing.client.closeSession().catch(() => undefined);
    sessions.delete(sessionId);
  }

  const token = await getAccessToken(cfg);
  const client = await loadResqmlClient();
  await client.openSession(etpUrl, token, cfg.partitionId);
  sessions.set(sessionId, { client, cacheKey: key, lastUsed: Date.now() });
  logger.info({ sessionId, etpUrl }, "Opened ETP session");
  return client;
}

// Closes and forgets the session's ETP client, used when a user switches back to
// REST, reconfigures OSDU, or the session ends.
export async function closeEtpClient(sessionId: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  sessions.delete(sessionId);
  await entry.client.closeSession().catch(() => undefined);
  logger.info({ sessionId }, "Closed ETP session");
}

const reaper = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.lastUsed > IDLE_TIMEOUT_MS) {
      sessions.delete(id);
      void entry.client.closeSession().catch(() => undefined);
    }
  }
}, 60_000);
reaper.unref?.();

// --- Operation wrappers ----------------------------------------------------
// Each returns JSON shaped to match the corresponding REST response so the
// proxy routes and the frontend stay contract-identical. The shapes are best
// effort against the documented ResqmlClient return types and MUST be verified
// against a live ETP session before ETP mode is enabled for users.

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const field of ["items", "resources", "objects", "dataObjects", "results"]) {
      const inner = (value as Record<string, unknown>)[field];
      if (Array.isArray(inner)) return inner;
    }
  }
  return value == null ? [] : [value];
}

function resourceName(resource: unknown): string {
  const record = resource as Record<string, unknown>;
  return String(record?.name ?? record?.Name ?? record?.uri ?? "");
}

function resourceType(resource: unknown): string {
  const record = resource as Record<string, unknown>;
  return String(record?.datatype ?? record?.type ?? record?.qualifiedType ?? "");
}

export async function etpGetDataspaces(sessionId: string, cfg: OsduConfig): Promise<unknown> {
  const client = await getEtpClient(sessionId, cfg);
  const dataspaces = asArray(await client.getDataspaces()).map((entry) => {
    if (typeof entry === "string") return entry;
    const record = entry as Record<string, unknown>;
    return String(record?.path ?? record?.uri ?? record?.name ?? "");
  });
  return { dataspaces };
}

export async function etpGetResourceSummary(
  sessionId: string,
  cfg: OsduConfig,
  dataspace: string,
): Promise<unknown> {
  const client = await getEtpClient(sessionId, cfg);
  const resources = asArray(await client.getResources({ dataspace }));
  const counts = new Map<string, number>();
  for (const resource of resources) {
    const type = resourceType(resource);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return { resources: [...counts].map(([name, count]) => ({ name, count })) };
}

export async function etpGetResourcesOfType(
  sessionId: string,
  cfg: OsduConfig,
  dataspace: string,
  datatype: string,
): Promise<unknown> {
  const client = await getEtpClient(sessionId, cfg);
  const resources = asArray(await client.getResources({ dataspace }, undefined, [datatype]));
  return { resources };
}

export async function etpGetRecord(
  sessionId: string,
  cfg: OsduConfig,
  dataspace: string,
  datatype: string,
  uuid: string,
): Promise<unknown> {
  const client = await getEtpClient(sessionId, cfg);
  return client.getDataObjects([objectUri(dataspace, datatype, uuid)]);
}

export async function etpGetArray(
  sessionId: string,
  cfg: OsduConfig,
  dataspace: string,
  datatype: string,
  uuid: string,
  pathInResource: string,
): Promise<unknown> {
  const client = await getEtpClient(sessionId, cfg);
  return client.getDataArray(objectUri(dataspace, datatype, uuid), pathInResource);
}

export async function etpStartTransaction(
  sessionId: string,
  cfg: OsduConfig,
  dataspace: string,
): Promise<unknown> {
  const client = await getEtpClient(sessionId, cfg);
  return client.startTransaction(false, [dataspace], "osdu-explorer");
}

export async function etpPutObjects(
  sessionId: string,
  cfg: OsduConfig,
  objects: unknown,
  transactionId: string,
): Promise<unknown> {
  const client = await getEtpClient(sessionId, cfg);
  return client.putDataObjects(objects, transactionId);
}

export async function etpCommitTransaction(
  sessionId: string,
  cfg: OsduConfig,
  transactionId: string,
): Promise<unknown> {
  const client = await getEtpClient(sessionId, cfg);
  return client.commitTransaction(transactionId);
}

export async function etpDeleteRecord(
  sessionId: string,
  cfg: OsduConfig,
  dataspace: string,
  datatype: string,
  uuid: string,
): Promise<unknown> {
  const client = await getEtpClient(sessionId, cfg);
  return client.deleteObjects([objectUri(dataspace, datatype, uuid)]);
}

// A record that references the delete target, normalised to the same shape the
// REST /sources route returns so the frontend contract is identical.
export interface RdmsReferencer {
  uri: string;
  datatype: string;
  uuid: string;
  name: string;
}

// Discovers the records that reference the target (its "sources" — the objects
// whose deletion would otherwise be blocked by the target still existing). ETP
// exposes this through getResources with a "sources" scope; shape is best effort
// and MUST be verified live before ETP mode ships this feature.
export async function etpGetSources(
  sessionId: string,
  cfg: OsduConfig,
  dataspace: string,
  datatype: string,
  uuid: string,
): Promise<RdmsReferencer[]> {
  const client = await getEtpClient(sessionId, cfg);
  const resources = asArray(
    await client.getResources({ dataspace, uri: objectUri(dataspace, datatype, uuid) }, "sources"),
  );
  const referencers: RdmsReferencer[] = [];
  // Dedup by { datatype, uuid } and drop the target itself, matching the REST path.
  const seen = new Set<string>([`${datatype}|${uuid}`]);
  for (const resource of resources) {
    const record = resource as Record<string, unknown>;
    const uri = typeof record?.uri === "string" ? record.uri : "";
    const ref = parseObjectUri(uri);
    if (!ref) continue;
    const key = `${ref.datatype}|${ref.uuid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    referencers.push({ uri, datatype: ref.datatype, uuid: ref.uuid, name: resourceName(resource) });
  }
  return referencers;
}

// Deletes the target and every referencer atomically inside one transaction,
// rolling back on any failure. The whole "referenced-by" closure is deleted in a
// single commit, so no dangling references remain and no delete ordering matters.
export async function etpCascadeDelete(
  sessionId: string,
  cfg: OsduConfig,
  dataspace: string,
  uris: string[],
): Promise<{ deletedCount: number }> {
  const client = await getEtpClient(sessionId, cfg);
  const txId = extractTransactionId(await client.startTransaction(false, [dataspace], "osdu-explorer cascade delete"));
  if (!txId) throw new Error("ETP did not return a transaction id");
  try {
    await client.deleteObjects(uris, txId);
    await client.commitTransaction(txId);
    return { deletedCount: uris.length };
  } catch (err) {
    await client.rollbackTransaction(txId).catch(() => undefined);
    throw err;
  }
}
