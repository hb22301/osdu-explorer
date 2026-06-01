import { Router, type IRouter } from "express";
import { getOsduClient } from "../../lib/osdu-client";

const router: IRouter = Router();

const WDMS_ENDPOINT_MAP: Array<[string, string]> = [
  ["work-product-component--WellLog", "welllogs"],
  ["work-product-component--WellboreTrajectory", "wellboretrajectories"],
];

function ddmsSegmentForId(id: string): string | null {
  for (const [kindFragment, segment] of WDMS_ENDPOINT_MAP) {
    if (id.includes(kindFragment)) return segment;
  }
  return null;
}

router.post("/osdu/wdms/fetch", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }

  const body = req.body as unknown;
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as Record<string, unknown>).urns) ||
    ((body as Record<string, unknown>).urns as unknown[]).length === 0
  ) {
    res.status(400).json({ error: "Request body must include a non-empty 'urns' array." });
    return;
  }

  const ids = ((body as Record<string, unknown>).urns as unknown[])
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .slice(0, 50);
  if (ids.length === 0) {
    res.status(400).json({ error: "No valid record ID strings provided." });
    return;
  }

  const client = getOsduClient(cfg);

  const results = await Promise.all(
    ids.map(async (id) => {
      const segment = ddmsSegmentForId(id);
      if (!segment) {
        return {
          urn: id,
          status: "error" as const,
          error: `ID does not correspond to a supported WDMS kind (WellLog or WellboreTrajectory)`,
        };
      }
      const path = `/api/os-wellbore-ddms/ddms/v3/${segment}/${encodeURIComponent(id)}/data`;
      try {
        const { status, data } = await client.fetch(path, {
          headers: { Accept: "application/json" },
        });
        if (status === 200 && data) {
          return { urn: id, status: "found" as const, data: data as Record<string, unknown> };
        }
        return { urn: id, status: "error" as const, error: `HTTP ${status} from WDMS for ${id}` };
      } catch (err) {
        return {
          urn: id,
          status: "error" as const,
          error: err instanceof Error ? err.message : `Failed to fetch WDMS data for ${id}`,
        };
      }
    }),
  );

  res.json({ results });
});

export default router;
