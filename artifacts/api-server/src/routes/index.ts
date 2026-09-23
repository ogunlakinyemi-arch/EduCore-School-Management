import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import peopleRouter from "./people";
import academicRouter from "./academic";
import edupulseRouter from "./edupulse";
import partnersRouter from "./partners";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(peopleRouter);
router.use(academicRouter);
router.use(edupulseRouter);
router.use(partnersRouter);

export default router;
