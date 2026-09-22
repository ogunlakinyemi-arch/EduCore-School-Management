import { Router, type IRouter } from "express";
import healthRouter from "./health";
import edupulseRouter from "./edupulse";

const router: IRouter = Router();

router.use(healthRouter);
router.use(edupulseRouter);

export default router;
