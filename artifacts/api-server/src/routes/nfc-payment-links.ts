import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { AuthError, assertSchoolOperationalAccess, getUserContext, requireAuthentication } from "../middlewares/auth";
import { configuredTestAdapter } from "../lib/fee-providers/factory";
import { configuredStudentSubscriptionCheckoutBaseUrl } from "../lib/student-subscription-return-url";
import {
  expectedNfcAllocations, linkScopeSql, newNfcLinkReference, nfcLinkToken, nfcLinkTokenHash,
  publicLinkSql, publicNfcLink, requireNfcLinkDevelopment, simulateNfcLink,
} from "../services/nfc-payment-links";

const router = Router();
const tokenInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const generationInput = z.object({
  termId: z.number().int().positive(),
  mode: z.enum(["DEVELOPMENT_SIMULATION", "FLUTTERWAVE_SANDBOX"]),
}).strict();
const idFor = (req: Request) => z.coerce.number().int().positive().parse(req.params.subscriptionId);
const run = (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: any) => {
    void handler(req, res).catch(error => {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid payment-link request" });
        return;
      }
      next(error);
    });
  };

router.post("/public/nfc-payment-links/view", run(async (req, res) => {
  requireNfcLinkDevelopment();
  const { token } = tokenInput.parse(req.body);
  const row = (await pool.query(publicLinkSql, [nfcLinkTokenHash(token)])).rows[0];
  if (!row) throw new AuthError(404, "Invalid payment link");
  res.set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer").json(publicNfcLink(row));
}));

router.post("/public/nfc-payment-links/simulate", run(async (req, res) => {
  requireNfcLinkDevelopment();
  const { token, outcome } = tokenInput.extend({ outcome: z.enum(["SUCCESS", "FAILED"]) }).strict().parse(req.body);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await simulateNfcLink(db, token, outcome);
    await db.query("COMMIT");
    res.set("Cache-Control", "no-store").json(result);
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}));

router.post("/subscriptions/:subscriptionId/payment-link", requireAuthentication(), run(async (req, res) => {
  requireNfcLinkDevelopment();
  const subscriptionId = idFor(req);
  const input = generationInput.parse(req.body);
  const base = configuredStudentSubscriptionCheckoutBaseUrl();
  if (!base) throw new AuthError(503, "Development payment-page URL is unavailable");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const scope = (await db.query(`${linkScopeSql} WHERE b.subscription_id=$1 AND b.academic_term_id=$2`, [subscriptionId, input.termId])).rows[0];
    if (!scope) throw new AuthError(404, "The student's term subscription was not found");
    assertSchoolOperationalAccess(req, scope.schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
    if (Number(scope.amount) !== 5000 || scope.legacyInvoiceId
      || String(scope.verificationStatus).toLowerCase() === "verified"
      || ["active", "waived"].includes(String(scope.subscriptionStatus).toLowerCase())) {
      throw new AuthError(409, "This subscription is paid, exempt or requires legacy review");
    }
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`nfc-link:${subscriptionId}:${input.mode}`]);
    let row = (await db.query(
      `SELECT * FROM nfc_payment_links WHERE subscription_id=$1 AND mode=$2
         AND expires_at>NOW() AND status IN ('PENDING','SIMULATED_SUCCESS')
       ORDER BY id DESC LIMIT 1 FOR UPDATE`, [subscriptionId, input.mode],
    )).rows[0];
    if (!row) {
      let paymentId: number | null = null;
      if (input.mode === "FLUTTERWAVE_SANDBOX") {
        // Attach ONLY an existing checkout. Its unchanged adapter/webhook/finalizer owns verification.
        if (!process.env.FLUTTERWAVE_WEBHOOK_VERIF_HASH || !configuredTestAdapter("FLUTTERWAVE")) {
          throw new AuthError(503, "Configure sandbox webhook verification before sharing a provider checkout");
        }
        const payment = (await db.query(
          `SELECT id FROM student_subscription_payments WHERE subscription_id=$1 AND school_id=$2 AND student_id=$3
             AND academic_session_id=$4 AND academic_term_id=$5 AND provider='FLUTTERWAVE'
             AND provider_mode='SANDBOX' AND status='PENDING' AND checkout_url IS NOT NULL
           ORDER BY id DESC LIMIT 1`,
          [subscriptionId, scope.schoolId, scope.studentId, scope.sessionId, scope.termId],
        )).rows[0];
        if (!payment) throw new AuthError(409, "Initialize the existing Flutterwave sandbox checkout before sharing it");
        paymentId = payment.id;
      }
      const reference = newNfcLinkReference();
      const allocations = await expectedNfcAllocations(db, scope);
      row = (await db.query(
        `INSERT INTO nfc_payment_links(school_id,student_id,subscription_id,academic_session_id,academic_term_id,
          created_by,reference,token_hash,mode,payment_id,expected_allocations,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW()+INTERVAL '7 days') RETURNING *`,
        [scope.schoolId, scope.studentId, subscriptionId, scope.sessionId, scope.termId,
          getUserContext(req).user.id, reference, nfcLinkTokenHash(nfcLinkToken(reference)), input.mode,
          paymentId, JSON.stringify(allocations)],
      )).rows[0];
    }
    const token = nfcLinkToken(row.reference);
    const full = (await db.query(publicLinkSql, [nfcLinkTokenHash(token)])).rows[0];
    if (!full) throw new AuthError(409, "Payment link could not be resolved");
    // A fragment keeps the bearer token out of HTTP access logs and Referer headers.
    const url = new URL(`${base.replace(/\/$/, "")}/nfc/pay`);
    url.hash = token;
    await db.query("COMMIT");
    res.set("Cache-Control", "no-store").json({ ...publicNfcLink(full), paymentUrl: url.toString() });
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}));

router.post("/subscriptions/:subscriptionId/payment-link/cancel", requireAuthentication(), run(async (req, res) => {
  requireNfcLinkDevelopment();
  if (req.body && Object.keys(req.body).length) throw new AuthError(400, "Cancellation accepts no payment parameters");
  const subscriptionId = idFor(req);
  const scope = (await pool.query(`${linkScopeSql} WHERE b.subscription_id=$1`, [subscriptionId])).rows[0];
  if (!scope) throw new AuthError(404, "Subscription not found");
  assertSchoolOperationalAccess(req, scope.schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
  // This revokes the EduCore link, NOT an already-issued provider checkout or verified transaction.
  await pool.query(
    "UPDATE nfc_payment_links SET status='CANCELLED',updated_at=NOW() WHERE subscription_id=$1 AND status='PENDING'",
    [subscriptionId],
  );
  res.json({ cancelled: true });
}));
export default router;
