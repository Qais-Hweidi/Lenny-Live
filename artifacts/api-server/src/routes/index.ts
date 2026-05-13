import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import panelRouter from "./panel.js";
import debateRouter from "./debate.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(panelRouter);
router.use(debateRouter);

export default router;
