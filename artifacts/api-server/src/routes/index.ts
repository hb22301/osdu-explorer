import { Router, type IRouter } from "express";
import healthRouter from "./health";
import osduConfigRouter from "./osdu/config";
import osduSearchRouter from "./osdu/search";
import osduStorageRouter from "./osdu/storage";
import osduSchemaRouter from "./osdu/schema";
import osduLegalRouter from "./osdu/legal";
import osduConsoleRouter from "./osdu/console";
import osduWdmsRouter from "./osdu/wdms";

const router: IRouter = Router();

router.use(healthRouter);
router.use(osduConfigRouter);
router.use(osduSearchRouter);
router.use(osduStorageRouter);
router.use(osduSchemaRouter);
router.use(osduLegalRouter);
router.use(osduConsoleRouter);
router.use(osduWdmsRouter);

export default router;
