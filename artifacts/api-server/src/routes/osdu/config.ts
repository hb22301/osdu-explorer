import { Router, type IRouter } from "express";
import {
  SaveOsduConfigBody,
  SaveOsduConfigResponse,
  GetOsduConfigResponse,
  ClearOsduConfigResponse,
} from "@workspace/api-zod";
import { clearTokenCache } from "../../lib/osdu-client";

const router: IRouter = Router();

router.get("/osdu/config", (req, res): void => {
  const cfg = req.session.osduConfig;
  const result = GetOsduConfigResponse.parse({
    configured: !!cfg,
    baseUrl: cfg?.baseUrl ?? null,
    partitionId: cfg?.partitionId ?? null,
    tokenEndpoint: cfg?.tokenEndpoint ?? null,
    clientId: cfg?.clientId ?? null,
  });
  res.json(result);
});

router.post("/osdu/config", (req, res): void => {
  const parsed = SaveOsduConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { baseUrl, partitionId, tokenEndpoint, clientId, clientSecret, scope } = parsed.data;

  if (req.session.osduConfig) {
    clearTokenCache(req.session.osduConfig);
  }

  req.session.osduConfig = {
    baseUrl,
    partitionId,
    tokenEndpoint,
    clientId,
    clientSecret,
    scope: scope ?? undefined,
  };

  const result = SaveOsduConfigResponse.parse({
    configured: true,
    baseUrl,
    partitionId,
    tokenEndpoint,
    clientId,
  });
  res.json(result);
});

router.delete("/osdu/config", (req, res): void => {
  if (req.session.osduConfig) {
    clearTokenCache(req.session.osduConfig);
  }
  req.session.osduConfig = undefined;
  const result = ClearOsduConfigResponse.parse({
    configured: false,
    baseUrl: null,
    partitionId: null,
    tokenEndpoint: null,
    clientId: null,
  });
  res.json(result);
});

export default router;
