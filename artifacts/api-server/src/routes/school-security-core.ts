import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AuthError, requireAuthentication } from "../middlewares/auth";
import {
  assertSecurityRead,
  configureSecurityReader,
  createSecurityLocation,
  getSecurityDashboard,
  getSchoolSecurityAccess,
  getSecuritySettings,
  getParentChildSecuritySummary,
  grantInputSchema,
  grantSchoolSecurityStaff,
  listCampusPresence,
  listSecurityEvents,
  listEligibleSecurityDevices,
  listSecurityGrants,
  listSecurityLocations,
  listSecurityReaders,
  locationInputSchema,
  markSecurityCardLost,
  presenceReviewInputSchema,
  readerInputSchema,
  requireSecurityAccess,
  requireAnySecurityAccess,
  reviewCampusPresence,
  revokeSchoolSecurityGrant,
  securityEventTypeSchema,
  securitySettingsInputSchema,
  setSecurityLocationStatus,
  setSecurityReaderStatus,
  updateSecuritySettings,
} from "../services/school-security-core-service";

const router = Router();
router.use(requireAuthentication());

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  beforeId: z.coerce.number().int().positive().optional(),
}).strict();
const eventsQuery = listQuery.extend({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  eventType: securityEventTypeSchema.optional(),
  result: z.enum(["CONFIRMED", "REJECTED"]).optional(),
  studentId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
  message: "from must be earlier than or equal to to",
});
const presenceQuery = listQuery.extend({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict().refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
  message: "from must be earlier than or equal to to",
});
const statusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) }).strict();
const cardLostSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const dateRangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict().refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
  message: "from must be earlier than or equal to to",
});

const wrap = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };

function parse<S extends z.ZodType>(schema: S, value: unknown, message: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AuthError(400, message);
  return result.data;
}

function pathId(value: string | string[] | undefined, label: string) {
  if (typeof value !== "string") throw new AuthError(404, `${label} not found`);
  const result = id.safeParse(value);
  if (!result.success) throw new AuthError(404, `${label} not found`);
  return result.data;
}

function range(fromValue?: string, toValue?: string) {
  const now = new Date();
  const from = fromValue ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const to = toValue ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)).toISOString();
  return { from, to };
}

router.get("/schools/:schoolId/security/dashboard", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  await assertSecurityRead(req, schoolId);
  const filters = parse(dateRangeSchema, req.query, "Invalid dashboard date range");
  const dates = range(filters.from, filters.to);
  res.json(await getSecurityDashboard(schoolId, dates.from, dates.to));
}));

router.get("/schools/:schoolId/security/access", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  res.json(await getSchoolSecurityAccess(req, schoolId));
}));

router.get("/schools/:schoolId/security/events", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  const filters = parse(eventsQuery, req.query, "Invalid security event filters");
  if (filters.studentId !== undefined &&
      filters.eventType === "EXIT" &&
      filters.result === "CONFIRMED") {
    await requireAnySecurityAccess(req, schoolId, ["SECURITY_READ", "PICKUP_APPROVE"]);
  } else {
    await assertSecurityRead(req, schoolId);
  }
  const items = await listSecurityEvents(schoolId, filters);
  res.json({
    items,
    nextCursor: items.length === filters.limit ? items[items.length - 1]?.id ?? null : null,
  });
}));

router.get("/schools/:schoolId/security/presence", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  await requireAnySecurityAccess(req, schoolId, ["SECURITY_READ", "REVIEW_PRESENCE"]);
  const filters = parse(presenceQuery, req.query, "Invalid presence filters");
  const items = await listCampusPresence(
    schoolId, filters.limit, filters.beforeId, filters.from, filters.to,
  );
  res.json({
    items,
    nextCursor: items.length === filters.limit ? items[items.length - 1]?.id ?? null : null,
  });
}));

router.post("/schools/:schoolId/security/presence/:presenceId/review", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  const presenceId = pathId(req.params.presenceId, "Presence record");
  await requireSecurityAccess(req, schoolId, "REVIEW_PRESENCE");
  const input = parse(presenceReviewInputSchema, req.body, "Invalid presence review");
  res.json(await reviewCampusPresence(req, schoolId, presenceId, input));
}));

router.get("/schools/:schoolId/security/locations", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  await requireAnySecurityAccess(req, schoolId, ["SECURITY_READ", "MANAGE_READERS"]);
  res.json(await listSecurityLocations(schoolId));
}));

router.post("/schools/:schoolId/security/locations", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  await requireSecurityAccess(req, schoolId, "MANAGE_READERS");
  const input = parse(locationInputSchema, req.body, "Invalid security location");
  res.status(201).json(await createSecurityLocation(req, schoolId, input));
}));

router.patch("/schools/:schoolId/security/locations/:locationId/status", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  const locationId = pathId(req.params.locationId, "Security location");
  await requireSecurityAccess(req, schoolId, "MANAGE_READERS");
  const input = parse(statusSchema, req.body, "Invalid security location status");
  res.json(await setSecurityLocationStatus(req, schoolId, locationId, input.status));
}));

router.get("/schools/:schoolId/security/readers", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  await requireAnySecurityAccess(req, schoolId, ["SECURITY_READ", "MANAGE_READERS"]);
  res.json(await listSecurityReaders(schoolId));
}));

router.get("/schools/:schoolId/security/eligible-devices", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  await requireAnySecurityAccess(req, schoolId, ["SECURITY_READ", "MANAGE_READERS"]);
  res.json(await listEligibleSecurityDevices(schoolId));
}));

router.post("/schools/:schoolId/security/readers", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  await requireSecurityAccess(req, schoolId, "MANAGE_READERS");
  const input = parse(readerInputSchema, req.body, "Invalid security reader");
  res.status(201).json(await configureSecurityReader(req, schoolId, input));
}));

router.patch("/schools/:schoolId/security/readers/:readerId/status", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  const readerId = pathId(req.params.readerId, "Security reader");
  await requireSecurityAccess(req, schoolId, "MANAGE_READERS");
  const input = parse(statusSchema, req.body, "Invalid security reader status");
  res.json(await setSecurityReaderStatus(req, schoolId, readerId, input.status));
}));

router.get("/schools/:schoolId/security/settings", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  await requireAnySecurityAccess(req, schoolId, ["SECURITY_READ", "MANAGE_READERS"]);
  res.json(await getSecuritySettings(schoolId));
}));

router.put("/schools/:schoolId/security/settings", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  await requireSecurityAccess(req, schoolId, "SECURITY_MANAGE");
  const input = parse(securitySettingsInputSchema, req.body, "Invalid security settings");
  res.json(await updateSecuritySettings(req, schoolId, input));
}));

router.get("/schools/:schoolId/security/grants", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  await requireSecurityAccess(req, schoolId, "SECURITY_MANAGE");
  res.json(await listSecurityGrants(schoolId));
}));

router.post("/schools/:schoolId/security/grants", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  const input = parse(grantInputSchema, req.body, "Invalid delegated security grant");
  res.status(201).json(await grantSchoolSecurityStaff(req, schoolId, input));
}));

router.post("/schools/:schoolId/security/grants/:grantId/revoke", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  const grantId = pathId(req.params.grantId, "Security grant");
  res.json(await revokeSchoolSecurityGrant(req, schoolId, grantId));
}));

router.post("/schools/:schoolId/security/cards/:cardId/lost", wrap(async (req, res) => {
  const schoolId = pathId(req.params.schoolId, "School");
  const cardId = pathId(req.params.cardId, "NFC card");
  await requireSecurityAccess(req, schoolId, "MANAGE_CARDS");
  const input = parse(cardLostSchema, req.body, "A loss reason is required");
  res.json(await markSecurityCardLost(req, schoolId, cardId, input.reason));
}));

router.get("/parent/children/:studentId/security", wrap(async (req, res) => {
  const studentId = pathId(req.params.studentId, "Student");
  res.json(await getParentChildSecuritySummary(req, studentId));
}));

export default router;