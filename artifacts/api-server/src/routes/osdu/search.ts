import { Router, type IRouter } from "express";
import { SearchOsduRecordsBody, SearchOsduRecordsResponse } from "@workspace/api-zod";
import { getOsduClient } from "../../lib/osdu-client";

const router: IRouter = Router();

router.post("/osdu/search", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }

  const parsed = SearchOsduRecordsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { kind, query, limit, offset, returnedFields, sort } = parsed.data;

  const client = getOsduClient(cfg);
  const osduBody: Record<string, unknown> = {
    kind,
    limit: limit ?? 10,
    offset: offset ?? 0,
  };

  if (query) osduBody.query = query;
  if (returnedFields && returnedFields.length > 0) osduBody.returnedFields = returnedFields;
  if (sort) osduBody.sort = sort;

  const { status, data } = await client.fetch("/api/search/v2/query", {
    method: "POST",
    body: osduBody,
  });

  if (status !== 200) {
    req.log.warn({ status, data }, "OSDU search error");
    res.status(status >= 400 && status < 600 ? status : 502).json({ error: "OSDU search failed", details: data });
    return;
  }

  const osduData = data as { results?: unknown[]; totalCount?: number; aggregations?: unknown };
  const result = SearchOsduRecordsResponse.parse({
    results: osduData.results ?? [],
    totalCount: osduData.totalCount ?? 0,
    aggregations: osduData.aggregations ?? null,
  });

  res.json(result);
});

export default router;
