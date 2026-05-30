import { Router, type IRouter } from "express";
import {
  GetOsduRecordParams,
  GetOsduRecordResponse,
  GetOsduRecordVersionsParams,
  GetOsduRecordVersionsResponse,
  ListOsduKindsQueryParams,
  ListOsduKindsResponse,
} from "@workspace/api-zod";
import { getOsduClient } from "../../lib/osdu-client";

const router: IRouter = Router();

router.get("/osdu/records/:id", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }

  const params = GetOsduRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const recordId = params.data.id;
  const client = getOsduClient(cfg);
  const { status, data } = await client.fetch(`/api/storage/v2/records/${encodeURIComponent(recordId)}`);

  if (status === 404) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (status !== 200) {
    req.log.warn({ status, data }, "OSDU get record error");
    res.status(status >= 400 && status < 600 ? status : 502).json({ error: "Failed to fetch record", details: data });
    return;
  }

  const record = data as Record<string, unknown>;
  const result = GetOsduRecordResponse.parse({
    id: record.id ?? null,
    kind: record.kind ?? null,
    version: record.version ?? null,
    acl: record.acl ?? {},
    legal: record.legal ?? {},
    data: record.data ?? {},
    meta: record.meta ?? [],
    ancestry: record.ancestry ?? {},
    tags: record.tags ?? {},
  });

  res.json(result);
});

router.get("/osdu/records/:id/versions", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }

  const params = GetOsduRecordVersionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const recordId = params.data.id;
  const client = getOsduClient(cfg);
  const { status, data } = await client.fetch(`/api/storage/v2/records/${encodeURIComponent(recordId)}/versions`);

  if (status !== 200) {
    req.log.warn({ status, data }, "OSDU get record versions error");
    res.status(status >= 400 && status < 600 ? status : 502).json({ error: "Failed to fetch versions", details: data });
    return;
  }

  const versionData = data as { recordId?: string; versions?: number[] };
  const result = GetOsduRecordVersionsResponse.parse({
    recordId: versionData.recordId ?? recordId,
    versions: versionData.versions ?? [],
  });

  res.json(result);
});

router.get("/osdu/kinds", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }

  const queryParams = ListOsduKindsQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { limit, cursor } = queryParams.data;
  const client = getOsduClient(cfg);
  const { status, data } = await client.fetch("/api/storage/v2/query/kinds", {
    params: {
      limit: limit ?? 100,
      ...(cursor ? { cursor } : {}),
    },
  });

  if (status !== 200) {
    req.log.warn({ status, data }, "OSDU list kinds error");
    res.status(status >= 400 && status < 600 ? status : 502).json({ error: "Failed to list kinds", details: data });
    return;
  }

  const kindsData = data as { results?: string[]; cursor?: string };
  const result = ListOsduKindsResponse.parse({
    kinds: kindsData.results ?? [],
    cursor: kindsData.cursor ?? null,
  });

  res.json(result);
});

export default router;
