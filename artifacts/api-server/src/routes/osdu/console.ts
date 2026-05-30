import { Router, type IRouter } from "express";
import { getEntries, clearEntries } from "../../lib/console-store";

const router: IRouter = Router();

router.get("/osdu/console", (req, res): void => {
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  const offset = Number(req.query.offset ?? 0);
  const { entries, total } = getEntries(limit, offset);
  res.json({ entries, total });
});

router.delete("/osdu/console", (_req, res): void => {
  clearEntries();
  res.json({ cleared: true });
});

export default router;
