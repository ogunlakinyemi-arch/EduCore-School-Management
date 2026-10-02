import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  assertSchoolOperationalAccess,
  getUserContext,
  requireAuthentication,
  AuthError,
} from "../middlewares/auth";
import {
  finalizePromotionBatch,
  getPromotionBatch,
  getPromotionHistory,
  listPromotionBatches,
  preparePromotionBatch,
  preparePromotionBatchInputSchema,
  promotionBatchSchema,
  promotionBatchDetailSchema,
  promotionReviewInputSchema,
  reviewPromotionDecision,
} from "../services/promotion-expansion-service";

const router = Router();
router.use(requireAuthentication());

const idSchema = z.coerce.number().int().positive();
const schoolQuerySchema = z.object({ schoolId: idSchema });
const batchParamsSchema = z.object({ batchId: idSchema });
const studentParamsSchema = z.object({ batchId: idSchema, studentId: idSchema });
const listQuerySchema = z.object({
  schoolId: idSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const idempotencyKeySchema = z.string().trim().min(8).max(128);

const wrap = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AuthError(400, message);
  return result.data;
}

function actorFromRequest(req: Request) {
  const context = getUserContext(req);
  return {
    userId: context.user.id,
    clerkUserId: context.user.clerkUserId,
    email: context.user.email,
    firstName: context.user.firstName,
    lastName: context.user.lastName,
  };
}

function requireSchoolAdmin(req: Request, rawSchoolId: unknown) {
  const { schoolId } = parse(schoolQuerySchema, { schoolId: rawSchoolId }, "schoolId must be a positive integer");
  assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
  return schoolId;
}

function requireKey(req: Request) {
  return parse(idempotencyKeySchema, req.get("Idempotency-Key"), "A valid Idempotency-Key header is required");
}

router.post("/school/academics/promotions/batches", wrap(async (req, res) => {
  const schoolId = requireSchoolAdmin(req, req.query.schoolId);
  const input = parse(preparePromotionBatchInputSchema, req.body, "Invalid promotion batch preparation input");
  const result = await preparePromotionBatch(schoolId, input, requireKey(req), actorFromRequest(req));
  const batch = promotionBatchDetailSchema.parse(result.batch);
  res.status(result.replayed ? 200 : 201).json(batch);
}));

router.get("/school/academics/promotions/batches", wrap(async (req, res) => {
  const query = parse(listQuerySchema, req.query, "Invalid promotion batch list query");
  assertSchoolOperationalAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
  const batches = await listPromotionBatches(query.schoolId, query.limit ?? 50);
  res.json(batches.map((batch) => promotionBatchSchema.parse(batch)));
}));

router.get("/school/academics/promotions/batches/:batchId", wrap(async (req, res) => {
  const { batchId } = parse(batchParamsSchema, req.params, "batchId must be a positive integer");
  const schoolId = requireSchoolAdmin(req, req.query.schoolId);
  res.json(promotionBatchDetailSchema.parse(await getPromotionBatch(schoolId, batchId)));
}));

router.get("/school/academics/promotions/batches/:batchId/history", wrap(async (req, res) => {
  const { batchId } = parse(batchParamsSchema, req.params, "batchId must be a positive integer");
  const schoolId = requireSchoolAdmin(req, req.query.schoolId);
  await getPromotionBatch(schoolId, batchId);
  res.json(await getPromotionHistory(schoolId, batchId));
}));

router.patch("/school/academics/promotions/batches/:batchId/students/:studentId", wrap(async (req, res) => {
  const { batchId, studentId } = parse(studentParamsSchema, req.params, "Batch and student identifiers must be positive integers");
  const schoolId = requireSchoolAdmin(req, req.query.schoolId);
  const input = parse(promotionReviewInputSchema, req.body, "Invalid reviewed promotion decision");
  res.json(await reviewPromotionDecision(schoolId, batchId, studentId, input, actorFromRequest(req)));
}));

router.post("/school/academics/promotions/batches/:batchId/finalize", wrap(async (req, res) => {
  const { batchId } = parse(batchParamsSchema, req.params, "batchId must be a positive integer");
  const schoolId = requireSchoolAdmin(req, req.query.schoolId);
  const batch = await finalizePromotionBatch(schoolId, batchId, requireKey(req), actorFromRequest(req));
  res.json(promotionBatchDetailSchema.parse(batch));
}));

export default router;