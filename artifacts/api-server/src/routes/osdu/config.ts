import { Router, type IRouter } from "express";
import {
  SaveOsduConfigBody,
  SaveOsduConfigResponse,
  GetOsduConfigResponse,
  ClearOsduConfigResponse,
} from "@workspace/api-zod";
import { clearTokenCache, validateOsduConfig } from "../../lib/osdu-client";

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

router.post("/osdu/config", async (req, res): Promise<void> => {
  const parsed = SaveOsduConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { baseUrl, partitionId, tokenEndpoint, clientId, clientSecret, scope } = parsed.data;
  const nextConfig = {
    baseUrl,
    partitionId,
    tokenEndpoint,
    clientId,
    clientSecret,
    scope: scope ?? undefined,
  };

  // Always validate the credentials currently in the form, even when this
  // client ID and endpoint previously had a cached token.
  clearTokenCache(nextConfig);
  try {
    await validateOsduConfig(nextConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create an access token";
    res.status(401).json({ error: message });
    return;
  }

  if (req.session.osduConfig) {
    clearTokenCache(req.session.osduConfig);
  }

  req.session.osduConfig = nextConfig;

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
