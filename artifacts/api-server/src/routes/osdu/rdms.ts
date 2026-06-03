import { Router, type IRouter } from "express";
import { getOsduClient } from "../../lib/osdu-client";

const router: IRouter = Router();

router.get("/osdu/rdms/dataspaces", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
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
      res.status(status).json({ error: `HTTP ${status} from Reservoir DMS` });
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
  const client = getOsduClient(cfg);
  try {
    const path = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/resources`;
    const { status, data } = await client.fetch(path, {
      headers: { Accept: "application/json" },
    });
    if (status === 200 && data) {
      res.json(data);
    } else {
      res.status(status).json({ error: `HTTP ${status} from Reservoir DMS` });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch resources" });
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
  const client = getOsduClient(cfg);
  try {
    const path = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(uuid)}`;
    const { status, data } = await client.fetch(path, {
      headers: { Accept: "application/json" },
    });
    if (status === 200 && data) {
      res.json(data);
    } else {
      res.status(status).json({ error: `HTTP ${status} from Reservoir DMS` });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch record" });
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
  const client = getOsduClient(cfg);
  try {
    const path = `/api/reservoir-ddms/v2/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(datatype)}`;
    const { status, data } = await client.fetch(path, {
      headers: { Accept: "application/json" },
    });
    if (status === 200 && data) {
      res.json(data);
    } else {
      res.status(status).json({ error: `HTTP ${status} from Reservoir DMS` });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch resource records" });
  }
});

export default router;
