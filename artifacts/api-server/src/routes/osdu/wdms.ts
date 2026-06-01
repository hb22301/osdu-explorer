import { Router, type IRouter } from "express";
import { getOsduClient } from "../../lib/osdu-client";

const router: IRouter = Router();

const WDMS_ENDPOINT_MAP: Record<string, string> = {
  "work-product-component--WellLog": "welllogs",
  "work-product-component--WellboreTrajectory": "wellboretrajectories",
};

function ddmsPathSegment(kind: string | undefined): string | null {
  if (!kind) return null;
  for (const [k, segment] of Object.entries(WDMS_ENDPOINT_MAP)) {
    if (kind.includes(k)) return segment;
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

  const kind = typeof (body as Record<string, unknown>).kind === "string"
    ? ((body as Record<string, unknown>).kind as string)
    : undefined;

  const segment = ddmsPathSegment(kind);
  if (!segment) {
    res.status(400).json({ error: "Unsupported kind for Wellbore DMS. Only WellLog and WellboreTrajectory are supported." });
    return;
  }

  const client = getOsduClient(cfg);

  const results = await Promise.all(
    ids.map(async (id) => {
      const path = `/api/os-wellbore-ddms/ddms/v3/${segment}/${encodeURIComponent(id)}/data`;
      try {
        const { status, data } = await client.fetch(path, {
          headers: { Accept: "application/json" },
        });
        if (status === 200 && data) {
          const record = data as Record<string, unknown>;
          return { urn: id, status: "found" as const, data: record };
        }
        return {
          urn: id,
          status: "error" as const,
          error: `HTTP ${status} from WDMS for ${id}`,
        };
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
