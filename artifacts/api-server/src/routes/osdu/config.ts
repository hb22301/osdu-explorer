import { Router, type IRouter } from "express";
import {
  SaveOsduConfigBody,
  SaveOsduConfigResponse,
  GetOsduConfigResponse,
  ClearOsduConfigResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/osdu/config", (req, res): void => {
  const cfg = req.session.osduConfig;
  const result = GetOsduConfigResponse.parse({
    configured: !!cfg,
    baseUrl: cfg?.baseUrl ?? null,
    partitionId: cfg?.partitionId ?? null,
  });
  res.json(result);
});

router.post("/osdu/config", (req, res): void => {
  const parsed = SaveOsduConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  req.session.osduConfig = {
    baseUrl: parsed.data.baseUrl,
    partitionId: parsed.data.partitionId,
    token: parsed.data.token,
  };

  const result = SaveOsduConfigResponse.parse({
    configured: true,
    baseUrl: parsed.data.baseUrl,
    partitionId: parsed.data.partitionId,
  });
  res.json(result);
});

router.delete("/osdu/config", (req, res): void => {
  req.session.osduConfig = undefined;
  const result = ClearOsduConfigResponse.parse({
    configured: false,
    baseUrl: null,
    partitionId: null,
  });
  res.json(result);
});

export default router;
