import { Router, type IRouter } from "express";
import { getOsduClient } from "../../lib/osdu-client";
import {
  buildDecodedArrayResponse,
  isPlainArrayResponse,
  metadataElementIsSupported,
} from "../../lib/rdms-array-decode";
import {
  getEtpClient,
  isEtpClientAvailable,
  closeEtpClient,
  etpGetDataspaces,
  etpGetResourceSummary,
  etpGetResourcesOfType,
  etpGetRecord,
  etpGetArray,
  etpStartTransaction,
  etpPutObjects,
  etpCommitTransaction,
  etpDeleteRecord,
  etpGetSources,
  etpCascadeDelete,
} from "../../lib/etp-client";
import { parseObjectUri, extractTransactionId } from "../../lib/rdms-uri";

const router: IRouter = Router();

function rdmsMode(req: { session: { rdmsMode?: "rest" | "etp" } }): "rest" | "etp" {
  return req.session.rdmsMode ?? "rest";
}

function etpErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// Pull a human-readable message out of a Reservoir DDMS error body. The wire
// shape varies by error and content negotiation: a 412 referential-integrity
// refusal carries the reason in `description` (the NestJS PreconditionFailed
// shape, e.g. "3 dangling reference(s) in space demo/Volve"); a problem+json
// response uses `detail`; other codes use `message`; a plain string body is
// used as-is. Surfacing the server's own wording (rather than a bare
// "HTTP 412") lets the frontend detect referential-integrity refusals and show
// the matching guidance. `title` is a last resort (it is only the generic
// status phrase, e.g. "Precondition Failed", but still beats "HTTP 412").
function extractErrorDetail(data: unknown): string | null {
  if (typeof data === "string") return data.length > 0 ? data : null;
  if (data && typeof data === "object") {
    for (const key of ["message", "detail", "description", "reason", "error", "title"] as const) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return null;
}

// Cascade-delete discovery/orchestration tuning. `/sources` returns the full
// transitive "referenced-by" closure (recursive up to SOURCES_DEPTH); we page
// through it and stop at SOURCES_MAX so a pathological graph can never make the
// preview (or the resulting one-shot transaction) unbounded — the frontend warns
// when the list is truncated.
const SOURCES_DEPTH = 1000;
const SOURCES_PAGE_SIZE = 256;
const SOURCES_MAX = 2000;

interface RdmsReferencer {
  uri: string;
  datatype: string;
  uuid: string;
  name: string;
}

// Pages through the REST /sources endpoint, normalising each item to the
// { uri, datatype, uuid, name } shape the frontend uses and parsing the ETP URI
// into the { datatype, uuid } the delete calls address. Items whose URI does not
// parse (e.g. a dataspace-only URI) are skipped rather than failing the request.
async function collectRdmsSources(
  client: ReturnType<typeof getOsduClient>,
  dataspace: string,
  datatype: string,
  uuid: string,
): Promise<{ referencers: RdmsReferencer[]; truncated: boolean }> {
  const basePath = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(uuid)}/sources`;
  const referencers: RdmsReferencer[] = [];
  // Dedup by { datatype, uuid }: a transitive closure can list the same record
  // more than once via diamond reference paths, and the target itself can appear
  // in a cycle. Both would otherwise inflate the preview and issue a redundant
  // in-transaction delete.
  const seen = new Set<string>([`${datatype}|${uuid}`]);
  let skip = 0;
  let truncated = false;
  for (;;) {
    const { status, data } = await client.fetch(basePath, {
      params: {
        depth: String(SOURCES_DEPTH),
        countObjects: "true",
        $skip: String(skip),
        $top: String(SOURCES_PAGE_SIZE),
      },
      headers: { Accept: "application/json" },
    });
    if (status !== 200) throw new Error(`HTTP ${status} from Reservoir DDMS`);
    const page = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown> | null)?.items)
        ? ((data as Record<string, unknown>).items as unknown[])
        : [];
    for (const item of page) {
      const record = item as Record<string, unknown>;
      const uri = typeof record?.uri === "string" ? record.uri : "";
      const ref = parseObjectUri(uri);
      if (!ref) continue;
      const key = `${ref.datatype}|${ref.uuid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      referencers.push({ uri, datatype: ref.datatype, uuid: ref.uuid, name: String(record?.name ?? "") });
      if (referencers.length >= SOURCES_MAX) {
        truncated = true;
        break;
      }
    }
    if (truncated || page.length < SOURCES_PAGE_SIZE) break;
    skip += SOURCES_PAGE_SIZE;
  }
  return { referencers, truncated };
}

router.get("/osdu/rdms/mode", async (req, res): Promise<void> => {
  const etpAvailable = await isEtpClientAvailable();
  res.json({
    mode: etpAvailable ? rdmsMode(req) : "rest",
    etpAvailable,
    etpUnavailableReason: etpAvailable
      ? null
      : "ETP is unavailable on this server. Reservoir DDMS is using REST.",
  });
});

router.post("/osdu/rdms/mode", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }
  const mode = (req.body as { mode?: unknown } | undefined)?.mode;
  if (mode !== "rest" && mode !== "etp") {
    res.status(400).json({ error: "mode must be 'rest' or 'etp'." });
    return;
  }
  if (mode === "rest") {
    await closeEtpClient(req.sessionID);
    req.session.rdmsMode = "rest";
    res.json({ mode: "rest" });
    return;
  }
  if (!(await isEtpClientAvailable())) {
    req.session.rdmsMode = "rest";
    res.status(503).json({
      error: "ETP is unavailable on this server. Reservoir DDMS is using REST.",
    });
    return;
  }
  if (!cfg.etpUrl) {
    res.status(400).json({ error: "This connection has no ETP endpoint, so ETP mode is unavailable." });
    return;
  }
  // Warm the session so the toggle only succeeds when ETP is actually reachable.
  try {
    await getEtpClient(req.sessionID, cfg);
  } catch (err) {
    res.status(502).json({ error: `Could not open an ETP session: ${etpErrorMessage(err, "unknown error")}` });
    return;
  }
  req.session.rdmsMode = "etp";
  res.json({ mode: "etp" });
});

router.get("/osdu/rdms/dataspaces", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }
  if (rdmsMode(req) === "etp") {
    try {
      res.json(await etpGetDataspaces(req.sessionID, cfg));
    } catch (err) {
      res.status(502).json({ error: etpErrorMessage(err, "Failed to fetch dataspaces") });
    }
    return;
  }
  const client = getOsduClient(cfg);
  try {
    const { status, data } = await client.fetch("/api/reservoir-ddms/v2/dataspaces", {
      headers: { Accept: "application/json" },
    });
    if (status === 200 && data) {
      res.json(data);
    } else {
      res.status(status).json({ error: `HTTP ${status} from Reservoir DDMS` });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch dataspaces" });
  }
});

router.get("/osdu/rdms/dataspaces/:dataspace/resources", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }
  const { dataspace } = req.params;
  if (!dataspace) {
    res.status(400).json({ error: "Dataspace parameter is required." });
    return;
  }
  if (rdmsMode(req) === "etp") {
    try {
      res.json(await etpGetResourceSummary(req.sessionID, cfg, dataspace));
    } catch (err) {
      res.status(502).json({ error: etpErrorMessage(err, "Failed to fetch resources") });
    }
    return;
  }
  const client = getOsduClient(cfg);
  try {
    const path = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/resources`;
    const { status, data } = await client.fetch(path, {
      headers: { Accept: "application/json" },
    });
    if (status === 200 && data) {
      res.json(data);
    } else {
      res.status(status).json({ error: `HTTP ${status} from Reservoir DDMS` });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch resources" });
  }
});

router.get("/osdu/rdms/dataspaces/:dataspace/resources/:datatype/:uuid/arrays", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }
  const { dataspace, datatype, uuid } = req.params;
  const rawPath = typeof req.query.path === "string" ? req.query.path : null;
  if (!dataspace || !datatype || !uuid || !rawPath) {
    res.status(400).json({ error: "dataspace, datatype, uuid, and path query param are required." });
    return;
  }
  if (rdmsMode(req) === "etp") {
    try {
      res.json(await etpGetArray(req.sessionID, cfg, dataspace, datatype, uuid, rawPath));
    } catch (err) {
      res.status(502).json({ error: etpErrorMessage(err, "Failed to fetch array data") });
    }
    return;
  }
  const client = getOsduClient(cfg);
  try {
    const hdfPath = encodeURIComponent(rawPath.replace(/^\/+/, ""));
    const arrayPath = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(uuid)}/arrays/${hdfPath}`;

    // Read the element-type metadata first, and only request the compact base64
    // payload when it names a type we can decode. This transfers far fewer bytes
    // for large grids while keeping the { uid, data: { dimensions, data } } shape
    // the frontend and browser checks expect. If the metadata is unavailable
    // (e.g. an older server without this endpoint), we skip base64 entirely and
    // fall back to the plain JSON array below — never a wasted large transfer.
    // The base64 fast-path is best-effort: any failure (a missing metadata
    // endpoint, a dropped connection, or a body that fails to parse) must fall
    // through to the plain JSON array below, never fail the request — that is
    // exactly what the original single-GET route always returned.
    try {
      const metaResult = await client.fetch(`${arrayPath}/metadata`, {
        headers: { Accept: "application/json" },
      });
      if (metaResult.status === 200 && metadataElementIsSupported(metaResult.data)) {
        const dataResult = await client.fetch(arrayPath, {
          params: { format: "base64" },
          headers: { Accept: "application/json" },
        });
        if (dataResult.status === 200 && dataResult.data) {
          const decoded = buildDecodedArrayResponse(dataResult.data, metaResult.data);
          if (decoded) {
            res.json(decoded);
            return;
          }
          // The server may have ignored ?format=base64 and already returned the
          // plain JSON number array; if so, pass it straight through.
          if (isPlainArrayResponse(dataResult.data)) {
            res.json(dataResult.data);
            return;
          }
        }
      }
    } catch {
      // Fall through to the plain JSON array below.
    }

    // Fall back to the default JSON array for anything we cannot safely decode
    // (missing metadata, unknown element type, size mismatch, or an upstream error).
    const { status, data } = await client.fetch(arrayPath, {
      headers: { Accept: "application/json" },
    });
    if (status === 200 && data) {
      res.json(data);
    } else {
      res.status(status).json({ error: `HTTP ${status} from Reservoir DDMS` });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch array data" });
  }
});

router.get("/osdu/rdms/dataspaces/:dataspace/resources/:datatype/:uuid", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }
  const { dataspace, datatype, uuid } = req.params;
  if (!dataspace || !datatype || !uuid) {
    res.status(400).json({ error: "Dataspace, datatype and uuid parameters are required." });
    return;
  }
  if (rdmsMode(req) === "etp") {
    try {
      res.json(await etpGetRecord(req.sessionID, cfg, dataspace, datatype, uuid));
    } catch (err) {
      res.status(502).json({ error: etpErrorMessage(err, "Failed to fetch record") });
    }
    return;
  }
  const client = getOsduClient(cfg);
  try {
    const path = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(uuid)}`;
    const { status, data } = await client.fetch(path, {
      headers: { Accept: "application/json" },
    });
    if (status === 200 && data) {
      res.json(data);
    } else {
      res.status(status).json({ error: `HTTP ${status} from Reservoir DDMS` });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch record" });
  }
});

router.delete("/osdu/rdms/dataspaces/:dataspace/resources/:datatype/:uuid", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }
  const { dataspace, datatype, uuid } = req.params;
  if (!dataspace || !datatype || !uuid) {
    res.status(400).json({ error: "Dataspace, datatype and uuid parameters are required." });
    return;
  }
  if (rdmsMode(req) === "etp") {
    try {
      const data = await etpDeleteRecord(req.sessionID, cfg, dataspace, datatype, uuid);
      res.status(200).json(data ?? null);
    } catch (err) {
      res.status(502).json({ error: `Reservoir DDMS: ${etpErrorMessage(err, "Failed to delete record")}` });
    }
    return;
  }
  const client = getOsduClient(cfg);
  try {
    const path = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(uuid)}`;
    const { status, data } = await client.fetch(path, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    if (status >= 200 && status < 300) {
      res.status(status).json(data ?? null);
    } else {
      const detail = extractErrorDetail(data);
      res.status(status).json({ error: detail ? `Reservoir DDMS: ${detail}` : `HTTP ${status} from Reservoir DDMS` });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to delete record" });
  }
});

// Discovery: the records that reference this one (its transitive "referenced-by"
// closure). Deleting a record that still has referencers is refused by Reservoir
// DDMS (HTTP 412), so the delete dialog calls this first to preview exactly what
// would have to be removed together.
router.get(
  "/osdu/rdms/dataspaces/:dataspace/resources/:datatype/:uuid/sources",
  async (req, res): Promise<void> => {
    const cfg = req.session.osduConfig;
    if (!cfg) {
      res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
      return;
    }
    const { dataspace, datatype, uuid } = req.params;
    if (!dataspace || !datatype || !uuid) {
      res.status(400).json({ error: "Dataspace, datatype and uuid parameters are required." });
      return;
    }
    if (rdmsMode(req) === "etp") {
      try {
        const referencers = await etpGetSources(req.sessionID, cfg, dataspace, datatype, uuid);
        res.json({ referencers, truncated: false });
      } catch (err) {
        res.status(502).json({ error: etpErrorMessage(err, "Failed to discover referencing records") });
      }
      return;
    }
    const client = getOsduClient(cfg);
    try {
      const result = await collectRdmsSources(client, dataspace, datatype, uuid);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to discover referencing records" });
    }
  },
);

// Atomic cascade delete: removes the confirmed referencer set and the target in
// one transaction, rolling back if any delete or the commit fails, so the
// dataspace is never left partially deleted. The referencer set is exactly what
// the user confirmed in the dialog (passed in the body), not a fresh server-side
// re-discovery — that keeps the blast radius the user saw and approved.
router.post("/osdu/rdms/dataspaces/:dataspace/cascade-delete", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }
  const { dataspace } = req.params;
  const body = req.body as
    | { target?: { datatype?: unknown; uuid?: unknown }; referencers?: unknown }
    | undefined;
  const target = body?.target;
  const rawReferencers = Array.isArray(body?.referencers) ? body.referencers : [];
  if (
    !dataspace ||
    !target ||
    typeof target.datatype !== "string" ||
    typeof target.uuid !== "string"
  ) {
    res.status(400).json({ error: "A target { datatype, uuid } and referencers array are required." });
    return;
  }
  const referencers: { datatype: string; uuid: string }[] = [];
  for (const entry of rawReferencers) {
    const record = entry as Record<string, unknown>;
    if (typeof record?.datatype === "string" && typeof record?.uuid === "string") {
      referencers.push({ datatype: record.datatype, uuid: record.uuid });
    }
  }
  // Delete referencers first, target last. Inside one transaction the order does
  // not affect the outcome, but it keeps the sequence intuitive if it is inspected.
  const deletions = [...referencers, { datatype: target.datatype, uuid: target.uuid }];

  if (rdmsMode(req) === "etp") {
    try {
      const uris = deletions.map(
        (d) => `eml:///dataspace('${dataspace}')/${d.datatype}(${d.uuid})`,
      );
      const result = await etpCascadeDelete(req.sessionID, cfg, dataspace, uris);
      res.json({ ok: true, deletedCount: result.deletedCount });
    } catch (err) {
      res.status(502).json({ error: `Reservoir DDMS: ${etpErrorMessage(err, "Failed to delete records")}` });
    }
    return;
  }

  const client = getOsduClient(cfg);
  const dsPath = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}`;

  // Best-effort rollback used on any failure after the transaction is open. A 410
  // (WEBSOCKET_SESSION_TERMINATED) means the transaction is already dead, so we
  // never try to roll back in that case.
  const rollback = async (transactionId: string): Promise<void> => {
    try {
      await client.fetch(`${dsPath}/transactions/${encodeURIComponent(transactionId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
    } catch {
      // Swallow — the original failure is what we report to the user.
    }
  };

  let transactionId: string | null = null;
  try {
    const txResult = await client.fetch(`${dsPath}/transactions`, {
      method: "POST",
      body: {},
      headers: { Accept: "application/json" },
    });
    if (txResult.status < 200 || txResult.status >= 300) {
      const detail = extractErrorDetail(txResult.data);
      res.status(502).json({
        error: detail ? `Reservoir DDMS: ${detail}` : `Could not start a transaction (HTTP ${txResult.status}).`,
      });
      return;
    }
    transactionId = extractTransactionId(txResult.data);
    if (!transactionId) {
      res.status(502).json({ error: "Reservoir DDMS did not return a transaction id." });
      return;
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to start a transaction" });
    return;
  }

  try {
    for (const d of deletions) {
      const path = `${dsPath}/resources/${encodeURIComponent(d.datatype)}/${encodeURIComponent(d.uuid)}`;
      const { status, data } = await client.fetch(path, {
        method: "DELETE",
        params: { transactionId },
        headers: { Accept: "application/json" },
      });
      // 404 = already gone; the closure the user saw may have shifted underneath
      // them. Treat as success for that record and keep going.
      if (status === 404) continue;
      if (status < 200 || status >= 300) {
        if (status !== 410) await rollback(transactionId);
        const detail = extractErrorDetail(data);
        res.status(status).json({
          error: detail ? `Reservoir DDMS: ${detail}` : `HTTP ${status} while deleting a record.`,
        });
        return;
      }
    }

    const commit = await client.fetch(`${dsPath}/transactions/${encodeURIComponent(transactionId)}`, {
      method: "PUT",
      headers: { Accept: "application/json" },
    });
    if (commit.status < 200 || commit.status >= 300) {
      if (commit.status !== 410) await rollback(transactionId);
      const detail = extractErrorDetail(commit.data);
      res.status(commit.status).json({
        error: detail ? `Reservoir DDMS: ${detail}` : `HTTP ${commit.status} while committing the deletion.`,
      });
      return;
    }
    res.json({ ok: true, deletedCount: deletions.length });
  } catch (err) {
    await rollback(transactionId);
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to delete records" });
  }
});

router.get("/osdu/rdms/dataspaces/:dataspace/resources/:datatype", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }
  const { dataspace, datatype } = req.params;
  if (!dataspace || !datatype) {
    res.status(400).json({ error: "Dataspace and datatype parameters are required." });
    return;
  }
  if (rdmsMode(req) === "etp") {
    try {
      res.json(await etpGetResourcesOfType(req.sessionID, cfg, dataspace, datatype));
    } catch (err) {
      res.status(502).json({ error: etpErrorMessage(err, "Failed to fetch resource records") });
    }
    return;
  }
  const client = getOsduClient(cfg);
  try {
    const path = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(datatype)}`;
    const { status, data } = await client.fetch(path, {
      headers: { Accept: "application/json" },
    });
    if (status === 200 && data) {
      res.json(data);
    } else {
      res.status(status).json({ error: `HTTP ${status} from Reservoir DDMS` });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch resource records" });
  }
});

router.post("/osdu/rdms/dataspaces/:dataspace/transactions", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }
  const { dataspace } = req.params;
  if (!dataspace) {
    res.status(400).json({ error: "Dataspace parameter is required." });
    return;
  }
  if (rdmsMode(req) === "etp") {
    try {
      res.json(await etpStartTransaction(req.sessionID, cfg, dataspace));
    } catch (err) {
      res.status(502).json({ error: etpErrorMessage(err, "Failed to create transaction") });
    }
    return;
  }
  const client = getOsduClient(cfg);
  try {
    const path = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/transactions`;
    const { status, data } = await client.fetch(path, {
      method: "POST",
      body: req.body,
      headers: { Accept: "application/json" },
    });
    res.status(status).json(data ?? null);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to create transaction" });
  }
});

router.put("/osdu/rdms/dataspaces/:dataspace/resources", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }
  const { dataspace } = req.params;
  const transactionId = typeof req.query.transactionId === "string" ? req.query.transactionId : null;
  if (!dataspace || !transactionId) {
    res.status(400).json({ error: "Dataspace and transactionId query param are required." });
    return;
  }
  if (rdmsMode(req) === "etp") {
    try {
      res.json(await etpPutObjects(req.sessionID, cfg, req.body, transactionId));
    } catch (err) {
      res.status(502).json({ error: etpErrorMessage(err, "Failed to update resource") });
    }
    return;
  }
  const client = getOsduClient(cfg);
  try {
    const path = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/resources`;
    const { status, data } = await client.fetch(path, {
      method: "PUT",
      body: req.body,
      params: { transactionId },
      headers: { Accept: "application/json" },
    });
    res.status(status).json(data ?? null);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to update resource" });
  }
});

router.put("/osdu/rdms/dataspaces/:dataspace/transactions/:transactionId", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }
  const { dataspace, transactionId } = req.params;
  if (!dataspace || !transactionId) {
    res.status(400).json({ error: "Dataspace and transactionId parameters are required." });
    return;
  }
  if (rdmsMode(req) === "etp") {
    try {
      res.json(await etpCommitTransaction(req.sessionID, cfg, transactionId));
    } catch (err) {
      res.status(502).json({ error: etpErrorMessage(err, "Failed to commit transaction") });
    }
    return;
  }
  const client = getOsduClient(cfg);
  try {
    const path = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/transactions/${encodeURIComponent(transactionId)}`;
    const { status, data } = await client.fetch(path, {
      method: "PUT",
      headers: { Accept: "application/json" },
    });
    res.status(status).json(data ?? null);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to commit transaction" });
  }
});

export default router;
