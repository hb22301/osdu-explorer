import { Router, type IRouter } from "express";
import { getOsduClient } from "../../lib/osdu-client";

const router: IRouter = Router();

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
  const urns = ((body as Record<string, unknown>).urns as unknown[])
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .slice(0, 50);
  if (urns.length === 0) {
    res.status(400).json({ error: "No valid URN strings provided." });
    return;
  }

  const client = getOsduClient(cfg);

  const results = await Promise.all(
    urns.map(async (urn) => {
      // Parse UUID from urn://service/uuid:{uuid} or urn://service/{uuid}
      const uuidMatch = urn.match(/uuid:([0-9a-f-]{36})/i) ?? urn.match(/\/([0-9a-f-]{36})\/?$/i);
      const id = uuidMatch ? uuidMatch[1] : urn;

      // Try common OSDU Wellbore DDMS API paths in order
      const candidates = [
        `/api/os-wellbore-ddms/ddms/v3/welllogs/${encodeURIComponent(id)}`,
        `/api/os-wellbore-ddms/ddms/v3/wellbores/${encodeURIComponent(id)}`,
        `/api/os-wellbore-ddms/ddms/v2/welllogs/${encodeURIComponent(id)}`,
        `/api/os-wellbore-ddms/ddms/v2/wellbores/${encodeURIComponent(id)}`,
      ];

      for (const path of candidates) {
        try {
          const { status, data } = await client.fetch(path);
          if (status === 200 && data) {
            const record = data as Record<string, unknown>;
            // Flatten: if the response wraps data in a `data` field, hoist it
            const flat = record.data && typeof record.data === "object" && !Array.isArray(record.data)
              ? { ...(record.data as Record<string, unknown>), _id: record.id, _kind: record.kind }
              : record;
            return { urn, status: "found" as const, data: flat };
          }
        } catch {
          // try next path
        }
      }

      return { urn, status: "error" as const, error: `No WDMS record found for ${id}` };
    }),
  );

  res.json({ results });
});

export default router;
