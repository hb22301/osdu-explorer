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

  const { kind, query, limit, offset, trackTotalCount, returnedFields, sort } = parsed.data;

  // `aggregateBy` isn't in the generated request schema (adding it would need
  // an Orval regeneration), so read and validate it inline off the raw body.
  const aggregateByRaw = (req.body && typeof req.body === "object")
    ? (req.body as Record<string, unknown>).aggregateBy
    : undefined;
  const aggregateBy = typeof aggregateByRaw === "string" && aggregateByRaw.trim()
    ? aggregateByRaw.trim()
    : undefined;

  const client = getOsduClient(cfg);
  const osduBody: Record<string, unknown> = {
    kind,
    limit: limit ?? 10,
    offset: offset ?? 0,
  };

  if (query) osduBody.query = query;
  if (trackTotalCount !== undefined) osduBody.trackTotalCount = trackTotalCount;
  if (returnedFields && returnedFields.length > 0) osduBody.returnedFields = returnedFields;
  if (sort) osduBody.sort = sort;
  if (aggregateBy) osduBody.aggregateBy = aggregateBy;

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

  let result: ReturnType<typeof SearchOsduRecordsResponse.parse>;
  try {
    // OSDU returns `aggregations` as an array; the generated schema types it as
    // an object, so keep it out of the parse and normalize it separately below.
    result = SearchOsduRecordsResponse.parse({
      results: osduData.results ?? [],
      totalCount: osduData.totalCount ?? 0,
      aggregations: null,
    });
  } catch (parseErr) {
    req.log.warn({ parseErr, data }, "OSDU search response failed Zod validation — returning raw");
    result = {
      results: (osduData.results ?? []) as ReturnType<typeof SearchOsduRecordsResponse.parse>["results"],
      totalCount: typeof osduData.totalCount === "number" ? osduData.totalCount : 0,
      aggregations: null,
    };
  }

  res.json({ ...result, aggregations: normalizeAggregations(osduData.aggregations) });
});

// OSDU's Search aggregations come back as `[{ key, count }, ...]`. Normalize to
// that shape, dropping malformed buckets; returns null when absent.
function normalizeAggregations(raw: unknown): { key: string; count: number }[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .map((item) => {
      const bucket = (item ?? {}) as Record<string, unknown>;
      const key = typeof bucket.key === "string" ? bucket.key : null;
      const count = typeof bucket.count === "number" ? bucket.count : null;
      return key !== null && count !== null ? { key, count } : null;
    })
    .filter((bucket): bucket is { key: string; count: number } => bucket !== null);
}

export default router;
