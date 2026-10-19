import { pool, type DatabasePoolClient } from "@workspace/db";
import { AuthError, type UserContext } from "../middlewares/auth";
import { developmentPaymentNotificationsSuppressed } from "../lib/development-payment-notification-policy";
import { logger } from "../lib/logger";
import { createEmailProvider, type ProviderSendResult } from "./communication-providers";
import { auditAccountApplication as audit } from "./account-application-audit";
import { z } from "zod";

const outcomeAction = "Recorded application decision email status";
type Evidence = {
  notificationStatus?: string; reason?: string; retrySafe?: boolean; provider?: string;
  providerMessageId?: string; deliveryConfirmed?: boolean;
};
type Application = { id: number; status: string; notificationStatus: string };
type Queryable = Pick<DatabasePoolClient, "query">;

function owner(actor: UserContext) {
  if (!actor.roles.some(r => r.role === "PLATFORM_OWNER" && r.schoolId === null && r.status === "ACTIVE")) {
    throw new AuthError(403, "Platform Owner access is required");
  }
}

function readiness() {
  if (developmentPaymentNotificationsSuppressed()) return { ready: false, reason: "Development email sending is intentionally paused by the worker/payment-test notification lock.", provider: null };
  try {
    const provider = createEmailProvider();
    if (!["resend", "http-email"].includes(provider.provider)) {
      return { ready: false, reason: "A real email provider is not selected; simulated email is not delivery.", provider: null };
    }
    return { ready: true, reason: null, provider };
  } catch {
    return { ready: false, reason: "Email provider configuration is incomplete. Approval remains active; sending requires authorized configuration.", provider: null };
  }
}

async function evidenceFor(db: Queryable, id: number): Promise<Evidence> {
  return (await db.query(`SELECT metadata FROM audit_logs WHERE module='Account Applications'
    AND record_id::text=$1 AND action=$2 ORDER BY id DESC LIMIT 1`, [String(id), outcomeAction])).rows[0]?.metadata ?? {};
}

function canRetry(a: Application, evidence: Evidence) {
  return a.status !== "PENDING" && (["NOT_REQUESTED", "UNAVAILABLE"].includes(a.notificationStatus)
    || (a.notificationStatus === "FAILED" && evidence.notificationStatus === "FAILED" && evidence.retrySafe === true));
}

export async function withApplicationNotificationInfo<T extends Application>(rows: T[]) {
  const available = readiness();
  return Promise.all(rows.map(async a => {
    const evidence = await evidenceFor(pool, a.id);
    const matching = evidence.notificationStatus === a.notificationStatus;
    return {
      ...a,
      notificationReason: a.status === "PENDING" ? null
        : ["NOT_REQUESTED", "UNAVAILABLE", "FAILED"].includes(a.notificationStatus) && !available.ready ? available.reason
        : matching && evidence.reason ? evidence.reason
        : ["SENDING", "UNKNOWN"].includes(a.notificationStatus) ? "Provider outcome needs reconciliation. Do not resend without evidence."
        : a.notificationStatus === "FAILED" ? "Legacy failure has no safe-retry evidence; review the provider before resending." : null,
      notificationRetryAllowed: available.ready && canRetry(a, evidence),
      notificationCanReconcile: matching && evidence.provider === "resend" && Boolean(evidence.providerMessageId),
      notificationDeliveryConfirmed: matching && evidence.deliveryConfirmed === true,
      notificationProviderMessageId: matching ? evidence.providerMessageId ?? null : null,
    };
  }));
}

export async function notifyApplicationDecision(actor: UserContext, id: number, retry = false) {
  owner(actor);
  const client = await pool.connect();
  let a: Record<string, any>;
  let available: ReturnType<typeof readiness>;
  try {
    await client.query("BEGIN");
    const row = (await client.query("SELECT * FROM account_applications WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new AuthError(404, "Application not found");
    if (!["APPROVED", "REJECTED"].includes(row.status)) throw new AuthError(409, "Decide the application before notifying");
    if (!retry && row.notification_status !== "NOT_REQUESTED") { await client.query("COMMIT"); return; }
    const evidence = await evidenceFor(client, id);
    available = readiness();
    if (retry && !canRetry({ id, status: row.status, notificationStatus: row.notification_status }, evidence)) {
      throw new AuthError(409, "Email already accepted, in progress, or uncertain. Reconcile it; do not resend.");
    }
    if (retry && !available.ready) throw new AuthError(409, available.reason ?? "Email sending unavailable");
    await client.query("UPDATE account_applications SET notification_status='SENDING' WHERE id=$1", [id]);
    await audit(client, actor, id, "Claimed application decision email", { retry, idempotencyKey: `account-application-${id}-${row.status}` });
    await client.query("COMMIT");
    a = row;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }

  let status = "UNAVAILABLE";
  let evidence: Evidence = { reason: available.reason ?? undefined, retrySafe: true, deliveryConfirmed: false };
  if (available.ready && available.provider) {
    const provider = available.provider;
    const approved = a.status === "APPROVED";
    try {
      const result: ProviderSendResult = await provider.send({
        to: a.email,
        subject: `Yetenia EduCore application ${approved ? "approved" : "not approved"}`,
        body: approved
          ? `Your Yetenia EduCore ${a.applicant_type === "PARTNER" ? "Partner" : "School Admin"} application has been approved. You can now log in with your registered account to access your dashboard.`
          : `Your Yetenia EduCore application was not approved. Reason: ${a.rejection_reason}. This decision does not grant portal access.`,
        idempotencyKey: `account-application-${id}-${a.status}`,
      });
      const safe = ["CONFIGURATION", "AUTHENTICATION", "RATE_LIMITED", "INVALID_REQUEST"].includes(result.failure?.category ?? "");
      status = result.accepted && ["ACCEPTED", "DELIVERED"].includes(result.status) ? "ACCEPTED"
        : result.status === "SIMULATED" ? "UNAVAILABLE" : safe ? "FAILED" : "UNKNOWN";
      evidence = { provider: provider.provider, providerMessageId: result.providerMessageId, retrySafe: safe || result.status === "SIMULATED",
        deliveryConfirmed: false, reason: status === "ACCEPTED" ? "Email accepted by provider; delivery is not confirmed."
          : `Email not confirmed: ${result.failure?.category ?? result.status}. ${safe ? "Known rejection; notification-only retry is safe when enabled." : "Do not resend without reconciliation."}` };
    } catch {
      status = "UNKNOWN";
      evidence = { provider: provider.provider, retrySafe: false, deliveryConfirmed: false, reason: "Email transport outcome is unknown. Do not resend without provider evidence." };
    }
  }
  if (status !== "ACCEPTED") logger.warn({ applicationId: id, notificationStatus: status, retrySafe: evidence.retrySafe, reason: evidence.reason }, "Application email was not accepted");
  const final = await pool.connect();
  try {
    await final.query("BEGIN");
    await final.query("UPDATE account_applications SET notification_status=$2 WHERE id=$1 AND notification_status='SENDING'", [id, status]);
    await audit(final, actor, id, outcomeAction, { ...evidence, notificationStatus: status });
    await final.query("COMMIT");
  } catch (error) {
    await final.query("ROLLBACK");
    logger.warn({ applicationId: id, providerMessageId: evidence.providerMessageId, notificationStatus: status }, "Email outcome persistence failed; do not resend");
    throw error;
  } finally { final.release(); }
}

export async function reconcileApplicationNotification(actor: UserContext, id: number) {
  owner(actor);
  const a = (await pool.query("SELECT * FROM account_applications WHERE id=$1", [id])).rows[0];
  if (!a) throw new AuthError(404, "Application not found");
  const evidence = await evidenceFor(pool, id);
  if (evidence.provider !== "resend" || !evidence.providerMessageId || evidence.notificationStatus !== a.notification_status) {
    throw new AuthError(409, "No provider message ID is available for a verified lookup. Outcome remains unchanged; do not resend uncertain emails.");
  }
  if (!process.env.RESEND_API_KEY) throw new AuthError(409, "Provider lookup is unavailable; outcome remains unchanged");
  // Read-only provider lookup. This never calls the send endpoint, even while sending is paused.
  let receipt: { id?: string; to?: string[]; subject?: string; last_event?: string };
  try {
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(evidence.providerMessageId)}`, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Provider lookup refused");
    receipt = z.object({id:z.string(),to:z.array(z.string()),subject:z.string(),last_event:z.string().optional()}).parse(await response.json());
  } catch { throw new AuthError(503, "Provider status could not be verified. No email was resent and stored outcome is unchanged."); }
  const subject = `Yetenia EduCore application ${a.status === "APPROVED" ? "approved" : "not approved"}`;
  if (receipt.id !== evidence.providerMessageId || receipt.to?.length !== 1 || receipt.to[0].toLowerCase() !== a.email.toLowerCase() || receipt.subject !== subject) {
    throw new AuthError(409, "Provider receipt does not match this application; outcome unchanged");
  }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const locked = (await db.query("SELECT notification_status FROM account_applications WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (locked.notification_status !== a.notification_status) throw new AuthError(409, "Notification changed during lookup; refresh before reconciliation");
    const currentEvidence = await evidenceFor(db, id);
    if (currentEvidence.providerMessageId !== evidence.providerMessageId) throw new AuthError(409, "Provider evidence changed; refresh before reconciliation");
    await db.query("UPDATE account_applications SET notification_status='ACCEPTED' WHERE id=$1", [id]);
    await audit(db, actor, id, outcomeAction, { ...evidence, notificationStatus: "ACCEPTED", retrySafe: false,
      deliveryConfirmed: currentEvidence.deliveryConfirmed === true || receipt.last_event === "delivered", reason: `Provider reports ${receipt.last_event ?? "accepted"}; no additional email sent.` });
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
