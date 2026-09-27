import { Router, type IRouter } from "express";
import { getOsduClient } from "../../lib/osdu-client";

// Proxies the OSDU Entitlements Service so the ACL editor can autocomplete
// group names and check which groups the caller belongs to. Validation is
// inline rather than generated Zod — this endpoint isn't in the OpenAPI spec,
// and adding it there would require regenerating the Orval artifacts.

const router: IRouter = Router();

interface EntitlementsGroup {
  name: string;
  email: string;
  description: string;
}

router.get("/osdu/entitlements/groups", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }

  const client = getOsduClient(cfg);
  const { status: httpStatus, data } = await client.fetch("/api/entitlements/v2/groups");

  if (httpStatus !== 200) {
    req.log.warn({ status: httpStatus, data }, "OSDU list entitlements groups error");
    res.status(httpStatus >= 400 && httpStatus < 600 ? httpStatus : 502).json({ error: "Failed to list entitlement groups", details: data });
    return;
  }

  const body = data as { groups?: unknown[] };
  const groups: EntitlementsGroup[] = (Array.isArray(body.groups) ? body.groups : []).map((g: unknown) => {
    const group = (g ?? {}) as Record<string, unknown>;
    return {
      name: typeof group.name === "string" ? group.name : "",
      email: typeof group.email === "string" ? group.email : "",
      description: typeof group.description === "string" ? group.description : "",
    };
  }).filter((g) => g.email !== "");

  res.json({ groups });
});

export default router;
