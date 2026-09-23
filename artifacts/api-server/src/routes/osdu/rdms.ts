import { Router, type IRouter } from "express";
import { getOsduClient } from "../../lib/osdu-client";
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
} from "../../lib/etp-client";

const router: IRouter = Router();

function rdmsMode(req: { session: { rdmsMode?: "rest" | "etp" } }): "rest" | "etp" {
  return req.session.rdmsMode ?? "rest";
}

function etpErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
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
    const path = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(uuid)}/arrays/${hdfPath}`;
    const { status, data } = await client.fetch(path, {
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
      const detail =
        typeof data === "string"
          ? data
          : data && typeof data === "object" && "message" in data
            ? String((data as { message?: unknown }).message)
            : null;
      res.status(status).json({ error: detail ? `Reservoir DDMS: ${detail}` : `HTTP ${status} from Reservoir DDMS` });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to delete record" });
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
