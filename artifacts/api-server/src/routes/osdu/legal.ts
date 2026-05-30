import { Router, type IRouter } from "express";
import { ListOsduLegalTagsQueryParams, ListOsduLegalTagsResponse } from "@workspace/api-zod";
import { getOsduClient } from "../../lib/osdu-client";

const router: IRouter = Router();

router.get("/osdu/legal-tags", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }

  const queryParams = ListOsduLegalTagsQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { valid } = queryParams.data;
  const client = getOsduClient(cfg);
  const { status: httpStatus, data } = await client.fetch("/api/legal/v1/legaltags", {
    params: {
      ...(valid !== undefined ? { valid } : {}),
    },
  });

  if (httpStatus !== 200) {
    req.log.warn({ status: httpStatus, data }, "OSDU list legal tags error");
    res.status(httpStatus >= 400 && httpStatus < 600 ? httpStatus : 502).json({ error: "Failed to list legal tags", details: data });
    return;
  }

  const legalData = data as { legalTags?: unknown[] };
  const result = ListOsduLegalTagsResponse.parse({
    legalTags: (legalData.legalTags ?? []).map((t: unknown) => {
      const tag = t as Record<string, unknown>;
      return {
        name: tag.name ?? null,
        description: tag.description ?? null,
        properties: tag.properties ?? {},
      };
    }),
  });

  res.json(result);
});

export default router;
