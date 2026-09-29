import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import peopleRouter from "./people";
import academicRouter from "./academic";
import edupulseRouter from "./edupulse";
import partnersRouter, { publicPartnersRouter } from "./partners";
import bootstrapRouter from "./bootstrap";
import platformRouter from "./platform";
import attendanceRouter from "./attendance";
import attendanceFamilyRouter from "./attendance-family";
import attendanceDiscrepancyResolutionRouter from "./attendance-discrepancy-resolution";
import academicWorkRouter from "./academic-work";
import academicResultsRouter from "./academic-results";
import academicTimetableRouter from "./academic-timetable";
import peopleImportsRouter from "./people-imports";
import financeRouter from "./finance";
import financeNotificationsRouter from "./finance-notifications";
import invoiceNotificationsRouter from "./invoice-notifications";
import platformCompanyEmployeesRouter from "./platform-company-employees";
import communicationInboxRouter from "./communication-inbox";
import communicationCampaignsRouter from "./communication-campaigns";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bootstrapRouter);
router.use(publicPartnersRouter);
// Device credentials authenticate independently of Clerk. Every human-facing
// attendance handler applies requireAuthentication() explicitly.
router.use(attendanceRouter);
router.use(authRouter);
router.use(peopleRouter);
router.use(academicRouter);
router.use(edupulseRouter);
router.use(partnersRouter);
router.use(platformRouter);
router.use(platformCompanyEmployeesRouter);
router.use(attendanceFamilyRouter);
router.use(attendanceDiscrepancyResolutionRouter);
router.use(academicWorkRouter);
router.use(academicResultsRouter);
router.use(academicTimetableRouter);
router.use(peopleImportsRouter);
router.use(financeRouter);
router.use(financeNotificationsRouter);
router.use(invoiceNotificationsRouter);
router.use(communicationInboxRouter);
router.use(communicationCampaignsRouter);

export default router;
