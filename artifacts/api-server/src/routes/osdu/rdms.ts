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

export default router;
