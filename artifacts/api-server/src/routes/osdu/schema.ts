import { Router, type IRouter } from "express";
import {
  ListOsduSchemasQueryParams,
  ListOsduSchemasResponse,
  GetOsduSchemaParams,
  GetOsduSchemaResponse,
} from "@workspace/api-zod";
import { getOsduClient } from "../../lib/osdu-client";

const router: IRouter = Router();

router.get("/osdu/schemas", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }

  const queryParams = ListOsduSchemasQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { authority, source, entityType, status, limit, offset } = queryParams.data;
  const client = getOsduClient(cfg);
  const { status: httpStatus, data } = await client.fetch("/api/schema-service/v1/schema", {
    params: {
      ...(authority ? { authority } : {}),
      ...(source ? { source } : {}),
      ...(entityType ? { entityType } : {}),
      ...(status ? { status } : {}),
      limit: limit ?? 100,
      offset: offset ?? 0,
    },
  });

  if (httpStatus !== 200) {
    req.log.warn({ status: httpStatus, data }, "OSDU list schemas error");
    res.status(httpStatus >= 400 && httpStatus < 600 ? httpStatus : 502).json({ error: "Failed to list schemas", details: data });
    return;
  }

  const schemaData = data as { schemaInfos?: unknown[]; offset?: number; count?: number; totalCount?: number };
  const result = ListOsduSchemasResponse.parse({
    schemaInfos: (schemaData.schemaInfos ?? []).map((s: unknown) => {
      const info = s as Record<string, unknown>;
      return {
        kind: info.id ?? info.kind ?? null,
        status: (info.schemaInfo as Record<string, unknown> | undefined)?.status ?? info.status ?? null,
        createdBy: (info.schemaInfo as Record<string, unknown> | undefined)?.createdBy ?? info.createdBy ?? null,
        dateCreated: (info.schemaInfo as Record<string, unknown> | undefined)?.dateCreated ?? info.dateCreated ?? null,
        updatedBy: (info.schemaInfo as Record<string, unknown> | undefined)?.updatedBy ?? info.updatedBy ?? null,
        dateUpdated: (info.schemaInfo as Record<string, unknown> | undefined)?.dateUpdated ?? info.dateUpdated ?? null,
      };
    }),
    offset: schemaData.offset ?? 0,
    count: schemaData.count ?? 0,
    totalCount: schemaData.totalCount ?? 0,
  });

  res.json(result);
});

router.get("/osdu/schemas/:kind", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }

  const params = GetOsduSchemaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const kind = params.data.kind;
  const client = getOsduClient(cfg);
  const { status: httpStatus, data } = await client.fetch(`/api/schema-service/v1/schema/${encodeURIComponent(kind)}`);

  if (httpStatus === 404) {
    res.status(404).json({ error: "Schema not found" });
    return;
  }
  if (httpStatus !== 200) {
    req.log.warn({ status: httpStatus, data }, "OSDU get schema error");
    res.status(httpStatus >= 400 && httpStatus < 600 ? httpStatus : 502).json({ error: "Failed to fetch schema", details: data });
    return;
  }

  const schemaData = data as Record<string, unknown>;
  const result = GetOsduSchemaResponse.parse({
    kind: schemaData.id ?? schemaData.kind ?? kind,
    schema: schemaData.schema ?? {},
    status: (schemaData.schemaInfo as Record<string, unknown> | undefined)?.status ?? schemaData.status ?? null,
    createdBy: (schemaData.schemaInfo as Record<string, unknown> | undefined)?.createdBy ?? schemaData.createdBy ?? null,
    dateCreated: (schemaData.schemaInfo as Record<string, unknown> | undefined)?.dateCreated ?? schemaData.dateCreated ?? null,
  });

  res.json(result);
});

export default router;
