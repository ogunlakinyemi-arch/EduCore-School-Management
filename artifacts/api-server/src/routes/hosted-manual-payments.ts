import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { getUserContext, requireAuthentication } from "../middlewares/auth";
import { HostedPaymentError } from "../lib/hosted-manual-policy";
import { HostedManualPayments } from "../services/hosted-manual-payments";
import { HostedSchoolPayouts } from "../services/hosted-school-payouts";
import { PayHostedSchoolBody,AttachHostedSchoolPayoutReceiptBody } from "@workspace/api-zod";
import type { HostedActor } from "../services/hosted-payment-store";

const reference = z.string().regex(/^HCM1_[TL]_[a-f0-9]{32}$/);
const positive = z.coerce.number().int().positive();
const checkout = z.object({ subscriptionId: z.number().int().positive(), termId: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/) }).strict();
const settlement = z.object({ beneficiary: z.enum(["SCHOOL", "BRO"]), externalReference: z.string().trim().min(4).max(120),
  proofSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).transform(v => v.toLowerCase()).optional(),
  proofReceiptId: z.string().uuid().optional(),settlementDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ownershipConfirmed: z.literal(true) }).strict().refine(v => v.beneficiary === "SCHOOL"
    ? Boolean(v.proofReceiptId && v.settlementDate) : Boolean(v.proofSha256),
  "School settlements require an uploaded receipt and actual settlement date; BRO confirmations require evidence.");
export function hostedActor(req: Request): HostedActor {
  const context = getUserContext(req);
  const roles = context.roles.filter(r => r.status === "ACTIVE");
  const owner = roles.some(r => r.role === "PLATFORM_OWNER" && r.schoolId === null);
  const schoolIds = roles.filter(r => r.role === "SCHOOL_ADMIN" && r.schoolId !== null).map(r => r.schoolId!);
  if (!owner && !schoolIds.length) throw new HostedPaymentError(403, "FINANCE_ACCESS_REQUIRED", "School Admin or Owner access is required.");
  return { id: context.user.id, email: context.user.email, owner, schoolIds };
}
export function hostedError(res: Response, e: unknown) {
  if (e instanceof HostedPaymentError) return res.status(e.statusCode).json({ error: e.message, code: e.code });
  if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid payment request." });
  if ((e as { code?: string })?.code === "23505") return res.status(409).json({
    error: "A payment or settlement already uses this identity. Refresh and reconcile; do not pay again.", code: "FINANCIAL_IDENTITY_CONFLICT" });
  return res.status(503).json({ error: "Payment processing is unresolved. Refresh or reconcile; do not pay again.", code: "PAYMENT_UNRESOLVED" });
}
export function createHostedManualRouter(service: HostedManualPayments,payouts=new HostedSchoolPayouts(pool)) {
  const router = Router();
  router.use(requireAuthentication(), (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
  const run = (fn: (req: Request, actor: HostedActor) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      const actor=hostedActor(req),result=await fn(req,actor);
      if(!actor.owner && result && typeof result==="object") {
        const schoolView=(v:any)=>{
          const safe={...v};
          for(const k of ["broDueMinor","broSettled","platformNetMinor","platformNetAfterPayoutMinor","feeMinor","schoolPayoutFeeMinor","schoolPayoutFeeReviewRequired"]) delete safe[k];
          return safe;
        };
        const safe=schoolView(result);
        if(Array.isArray(safe.orders)) safe.orders=safe.orders.map(schoolView);
        if(safe.policy) safe.policy={grossMinor:safe.policy.grossMinor,schoolMinor:safe.policy.schoolMinor};
        delete safe.schoolPayouts;
        res.json(safe);
      } else res.json(result);
    } catch (e) { hostedError(res, e); }
  };
  router.get("/config", run((_req, _actor) => service.configuration()));
  router.get("/eligible", run((req, actor) => service.eligible(actor, positive.parse(req.query.schoolId))));
  router.get("/orders", run((req, actor) => service.list(actor, req.query.schoolId === undefined ? undefined : positive.parse(req.query.schoolId))));
  router.get("/orders/:reference", run((req, actor) => service.get(actor, reference.parse(req.params.reference))));
  router.post("/checkout", run((req, actor) => service.checkout(actor, checkout.parse(req.body))));
  router.post("/orders/:reference/reconcile", run((req, actor) => {
    z.object({}).strict().parse(req.body ?? {});
    return service.reconcile(actor, reference.parse(req.params.reference));
  }));
  router.post("/orders/:reference/settle", run((req, actor) => service.settle(actor,
    reference.parse(req.params.reference), settlement.parse(req.body))));
  router.get("/orders/:reference/school-payout",run((req,actor)=>payouts.preview(actor,reference.parse(req.params.reference))));
  router.post("/orders/:reference/school-payout",run((req,actor)=>payouts.pay(actor,
    reference.parse(req.params.reference),PayHostedSchoolBody.strict().parse(req.body))));
  router.post("/orders/:reference/school-payout/reconcile",run((req,actor)=>{
    z.object({}).strict().parse(req.body??{});
    return payouts.reconcile(actor,reference.parse(req.params.reference));
  }));
  router.post("/orders/:reference/school-payout/receipt",run((req,actor)=>payouts.attachReceipt(actor,
    reference.parse(req.params.reference),AttachHostedSchoolPayoutReceiptBody.strict().parse(req.body))));
  return router;
}
const service = new HostedManualPayments(pool);
export const hostedManualPaymentsRouter = createHostedManualRouter(service);
// Mounted BEFORE Clerk and JSON middleware, on its own raw-body endpoint.
export const hostedManualWebhookRouter = Router();
hostedManualWebhookRouter.post("/", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: "Expected a JSON webhook." }); return; }
    const body = JSON.parse(req.body.toString("utf8"));
    res.json(await service.webhook(req.get("verif-hash"), body));
  } catch (e) { hostedError(res, e); }
});
