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
  const requestedVersion = req.query.version;
  if (
    requestedVersion !== undefined &&
    (typeof requestedVersion !== "string" ||
      !/^[1-9]\d*$/.test(requestedVersion) ||
      !Number.isSafeInteger(Number(requestedVersion)))
  ) {
    res.status(400).json({ error: "Version must be a positive integer." });
    return;
  }

  const versionQuery =
    typeof requestedVersion === "string"
      ? `?version=${encodeURIComponent(requestedVersion)}`
      : "";
  const client = getOsduClient(cfg);
  const { status, data } = await client.fetch(
    `/api/storage/v2/records/${encodeURIComponent(recordId)}${versionQuery}`,
  );

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

router.put("/osdu/records", async (req, res): Promise<void> => {
  const cfg = req.session.osduConfig;
  if (!cfg) {
    res.status(401).json({ error: "OSDU not configured. Please set up your connection first." });
    return;
  }

  const records = req.body;
  if (!Array.isArray(records) || records.length === 0) {
    res.status(400).json({ error: "Request body must be a non-empty array of records." });
    return;
  }

  const client = getOsduClient(cfg);
  try {
    const { status, data } = await client.fetch("/api/storage/v2/records", {
      method: "PUT",
      body: records,
      headers: { Accept: "application/json" },
    });
    if (status >= 200 && status < 300) {
      res.status(status).json(data ?? null);
    } else {
      req.log.warn({ status, data }, "OSDU put records error");
      res.status(status >= 400 && status < 600 ? status : 502).json({ error: "Failed to save record", details: data });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to save record" });
  }
});

function storageErrorMessage(data: unknown, status: number, fallback: string): string {
  const detail =
    typeof data === "string" && data
      ? data
      : data && typeof data === "object" && "message" in data
        ? String((data as { message?: unknown }).message)
        : null;
  return detail ? `Storage Service: ${detail}` : `${fallback} (HTTP ${status})`;
}

// Logical (soft) delete: recoverable, retains versions.
router.post("/osdu/records/:id/delete", async (req, res): Promise<void> => {
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
  try {
    const { status, data } = await client.fetch(
      `/api/storage/v2/records/${encodeURIComponent(recordId)}:delete`,
      { method: "POST" },
    );
    if (status >= 200 && status < 300) {
      res.status(200).json({ ok: true });
    } else {
      req.log.warn({ status, data }, "OSDU soft delete record error");
      res.status(status >= 400 && status < 600 ? status : 502).json({ error: storageErrorMessage(data, status, "Failed to delete record") });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to delete record" });
  }
});

// Purge (hard) delete: permanent, removes the record and all versions.
router.delete("/osdu/records/:id", async (req, res): Promise<void> => {
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
  try {
    const { status, data } = await client.fetch(
      `/api/storage/v2/records/${encodeURIComponent(recordId)}`,
      { method: "DELETE" },
    );
    if (status >= 200 && status < 300) {
      res.status(200).json({ ok: true });
    } else {
      req.log.warn({ status, data }, "OSDU purge record error");
      res.status(status >= 400 && status < 600 ? status : 502).json({ error: storageErrorMessage(data, status, "Failed to purge record") });
    }
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to purge record" });
  }
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
