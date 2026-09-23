import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import peopleRouter from "./people";
import academicRouter from "./academic";
import edupulseRouter from "./edupulse";
import partnersRouter, { publicPartnersRouter } from "./partners";
import bootstrapRouter from "./bootstrap";
import platformRouter from "./platform";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bootstrapRouter);
router.use(publicPartnersRouter);
router.use(authRouter);
router.use(peopleRouter);
router.use(academicRouter);
router.use(edupulseRouter);
router.use(partnersRouter);
router.use(platformRouter);

export default router;
