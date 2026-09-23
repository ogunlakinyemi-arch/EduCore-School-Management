import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import peopleRouter from "./people";
import academicRouter from "./academic";
import edupulseRouter from "./edupulse";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(peopleRouter);
router.use(academicRouter);
router.use(edupulseRouter);

export default router;
