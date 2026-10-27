import { randomUUID } from "node:crypto";
import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { FlutterwaveHostedAdapter, type HostedCheckoutAdapter } from "../lib/hosted-checkout-adapter";
import { HOSTED_POLICY, HostedPaymentError, hostedAmounts, hostedConfiguration } from "../lib/hosted-manual-policy";
import { receiptDate } from "./payment-receipts";
import { schoolPayoutConfiguration } from "../lib/flutterwave-school-payout";
import { appendHostedEvent, hostedDatabaseReady, hostedOrderView, hostedTransaction, loadHostedOrder,
  requireHostedRead, type HostedActor, type HostedRow } from "./hosted-payment-store";

export class HostedManualPayments {
  constructor(private pool: StudentSubscriptionSqlPool, private env: NodeJS.ProcessEnv = process.env,
    private suppliedAdapter?: HostedCheckoutAdapter) {}
  async configuration() {
    const c = hostedConfiguration(this.env);
    const blockers = [...c.blockers];
    // Disabled deployments never query new tables and never start a migration.
    if (c.enabled && !await hostedDatabaseReady(this.pool)) blockers.push("Additive journal schema and exact append-only guards have not been verified.");
    const payout=schoolPayoutConfiguration(this.env);
    return { enabled: c.enabled, mode: c.mode, ready: blockers.length === 0, blockers, policy: HOSTED_POLICY,
      ledgerOnly: !payout.ready, schoolPayouts:{ready:payout.ready,mode:payout.mode,blockers:payout.blockers} };
  }
  private async runtime() {
    if (!(await this.configuration()).ready) throw new HostedPaymentError(503, "HOSTED_PAYMENTS_BLOCKED", "Hosted payments are not configured or their journal safeguards are unavailable.");
    const c = hostedConfiguration(this.env);
    return { ...c, adapter: this.suppliedAdapter ?? new FlutterwaveHostedAdapter(c.secret!, c.webhookHash!) };
  }
  async eligible(actor: HostedActor, schoolId: number) {
    await this.runtime(); requireHostedRead(actor, schoolId);
    if (actor.owner) return { subscriptions: [] }; // Platform ownership is never school-operation authority.
    return hostedTransaction(this.pool, async c => {
      const r = await c.query(`SELECT s.id AS "subscriptionId",s.student_id AS "studentId",s.school_id AS "schoolId",
        concat(st.first_name,' ',st.last_name) AS "studentName",t.id AS "termId",t.name AS "termName"
        FROM subscriptions s JOIN students st ON st.id=s.student_id AND st.school_id=s.school_id
        JOIN academic_terms t ON t.school_id=s.school_id AND t.name=s.term AND t.is_current=true
        WHERE s.school_id=$1 AND st.status='ACTIVE' AND lower(s.status)<>'active'
          AND lower(s.verification_status)<>'verified' AND s.amount=5000
          AND (s.expires_at::date=t.end_date+1 OR s.allocation_snapshot->>'termId'=t.id::text
            OR EXISTS(SELECT 1 FROM student_subscription_terms b WHERE b.subscription_id=s.id
              AND b.school_id=s.school_id AND b.student_id=s.student_id AND b.academic_term_id=t.id))
        ORDER BY st.last_name,st.first_name LIMIT 200`, [schoolId]);
      return { subscriptions: r.rows };
    });
  }
  async list(actor: HostedActor, schoolId?: number) {
    await this.runtime();
    if (schoolId) requireHostedRead(actor, schoolId);
    return hostedTransaction(this.pool, async c => {
      const { rows } = await c.query(`SELECT o.*,s.name AS school_name FROM hosted_checkout_orders o JOIN schools s ON s.id=o.school_id WHERE
        ($1::integer IS NULL OR o.school_id=$1) AND ($2::boolean OR o.school_id=ANY($3::integer[]))
        ORDER BY o.created_at DESC LIMIT 100`, [schoolId ?? null, actor.owner, actor.schoolIds]);
      return { orders: await Promise.all(rows.map(r => hostedOrderView(c, r))) };
    });
  }
  async get(actor: HostedActor, reference: string) {
    await this.runtime();
    return hostedTransaction(this.pool, async c => { const o = await loadHostedOrder(c, reference);
      requireHostedRead(actor, Number(o.school_id)); return hostedOrderView(c, o); });
  }
  async checkout(actor: HostedActor, input: { subscriptionId: number; termId: number; idempotencyKey: string }) {
    const runtime = await this.runtime();
    if (actor.owner) throw new HostedPaymentError(403, "SCHOOL_ADMIN_REQUIRED", "A School Admin must initiate collection.");
    const reservation = await hostedTransaction(this.pool, async c => {
      const r = await c.query(`SELECT s.*,st.status AS student_status,concat(st.first_name,' ',st.last_name) AS student_name,
        t.end_date::text AS term_end,t.name AS term_name
        FROM subscriptions s JOIN students st ON st.id=s.student_id AND st.school_id=s.school_id
        JOIN academic_terms t ON t.school_id=s.school_id AND t.name=s.term AND t.id=$2 AND t.is_current=true
        WHERE s.id=$1 AND s.school_id=ANY($3::integer[])
          AND (s.expires_at::date=t.end_date+1 OR s.allocation_snapshot->>'termId'=t.id::text
            OR EXISTS(SELECT 1 FROM student_subscription_terms b WHERE b.subscription_id=s.id
              AND b.school_id=s.school_id AND b.student_id=s.student_id AND b.academic_term_id=t.id))
        FOR UPDATE OF s`,
      [input.subscriptionId, input.termId, actor.schoolIds]);
      const s = r.rows[0];
      if (!s) throw new HostedPaymentError(404, "NOT_FOUND", "Current school subscription not found.");
      const prior = await c.query(`SELECT * FROM hosted_checkout_orders WHERE school_id=$1 AND student_id=$2 AND term_id=$3 AND environment=$4`,
        [s.school_id, s.student_id, input.termId, runtime.mode]);
      if (prior.rows[0]) return { order: prior.rows[0] as HostedRow, initialize: false };
      const key = await c.query(`SELECT reference FROM hosted_checkout_orders WHERE payer_user_id=$1 AND environment=$2 AND idempotency_key=$3`,
        [actor.id, runtime.mode, input.idempotencyKey]);
      if (key.rows.length) throw new HostedPaymentError(409, "IDEMPOTENCY_CONFLICT", "This request key belongs to another subscription.");
      if (Number(s.amount) !== 5000 || s.student_status !== "ACTIVE" || String(s.status).toLowerCase() === "active" || String(s.verification_status).toLowerCase() === "verified") {
        throw new HostedPaymentError(409, "ALREADY_ACTIVE", "An active subscription cannot be charged again.");
      }
      const existing = await c.query(`SELECT id FROM student_subscription_payments WHERE school_id=$1 AND student_id=$2
        AND academic_term_id=$3 AND status IN ('PENDING','RECONCILIATION_REQUIRED','PAID') LIMIT 1`,
      [s.school_id, s.student_id, input.termId]);
      if (existing.rows.length) throw new HostedPaymentError(409, "LEGACY_PAYMENT_REVIEW_REQUIRED", "Complete or reconcile the existing payment before changing checkout models.");
      const oldLive = await c.query(`SELECT to_regclass('public.flutterwave_live_subscription_intents') IS NOT NULL AS installed`);
      if (oldLive.rows[0]?.installed) {
        const priorLive = await c.query(`SELECT id FROM flutterwave_live_subscription_intents
          WHERE school_id=$1 AND student_id=$2 AND term_id=$3 LIMIT 1`, [s.school_id, s.student_id, input.termId]);
        if (priorLive.rows.length) throw new HostedPaymentError(409, "LEGACY_LIVE_REVIEW_REQUIRED", "The original LIVE intent must be reviewed; a replacement checkout cannot rebill it.");
      }
      // Freeze attribution/rule at checkout. Never infer or create a BRO entitlement from browser input.
      const bro = await c.query(`SELECT a.id AS attribution_id,a.partner_profile_id,r.id AS rule_id
        FROM school_partner_attributions a JOIN partner_profiles pp ON pp.id=a.partner_profile_id
        LEFT JOIN LATERAL (SELECT id FROM commission_rules WHERE status='ACTIVE' AND currency='NGN'
          AND (term=$2 OR term IS NULL) AND effective_at<=now() AND (ends_at IS NULL OR ends_at>now())
          AND allocation_total=5000 AND school_amount=1900 AND partner_amount=100 AND edupulse_amount=3000
          ORDER BY (term=$2) DESC NULLS LAST,effective_at DESC,id DESC LIMIT 1) r ON true
        WHERE a.school_id=$1 AND a.is_current=true AND a.status='ACTIVE' AND pp.status='ACTIVE'
          AND a.starts_at<=now() AND (a.ends_at IS NULL OR a.ends_at>now()) ORDER BY a.starts_at DESC,a.id DESC LIMIT 1`,
      [s.school_id, s.term_name]);
      if (bro.rows[0] && !bro.rows[0].rule_id) throw new HostedPaymentError(409, "BRO_RULE_REQUIRED", "The school's BRO requires an approved matching commission rule.");
      const reference = `HCM1_${runtime.mode === "LIVE" ? "L" : "T"}_${randomUUID().replaceAll("-", "")}`;
      const snapshot = { studentName: s.student_name, termName: s.term_name, termEnd: s.term_end,
        attributionId: bro.rows[0]?.attribution_id ?? null, commissionRuleId: bro.rows[0]?.rule_id ?? null, policy: HOSTED_POLICY };
      const inserted = await c.query(`INSERT INTO hosted_checkout_orders
        (reference,environment,subscription_id,school_id,student_id,term_id,payer_user_id,bro_profile_id,snapshot,idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
      [reference, runtime.mode, s.id, s.school_id, s.student_id, input.termId, actor.id,
        bro.rows[0]?.partner_profile_id ?? null, JSON.stringify(snapshot), input.idempotencyKey]);
      const order = inserted.rows[0];
      await appendHostedEvent(c, order, "CHECKOUT_CLAIMED", "checkout-claim", { actorId: actor.id });
      return { order: order as HostedRow, initialize: true };
    });
    if (reservation.initialize) {
      // Persist the claim BEFORE provider I/O. A lost response never starts a second checkout.
      try {
        const checkoutUrl = await runtime.adapter.initialize({ reference: reservation.order.reference, email: actor.email,
          mode: runtime.mode, returnUrl: `${runtime.publicBase}/hosted-payments?reference=${encodeURIComponent(reservation.order.reference)}` });
        await hostedTransaction(this.pool, async c => { const o = await loadHostedOrder(c, reservation.order.reference, true);
          await appendHostedEvent(c, o, "CHECKOUT_READY", "checkout-ready", { data: { checkoutUrl } }); });
      } catch {
        await hostedTransaction(this.pool, async c => { const o = await loadHostedOrder(c, reservation.order.reference, true);
          await appendHostedEvent(c, o, "CHECKOUT_UNKNOWN", "checkout-unknown", { data: { reason: "PROVIDER_ACCEPTANCE_UNCERTAIN" } }); });
      }
    }
    return this.get(actor, reservation.order.reference);
  }
  async reconcile(actor: HostedActor, reference: string) {
    const runtime = await this.runtime();
    const before = await this.get(actor, reference);
    if (before.environment !== runtime.mode) throw new HostedPaymentError(409, "MODE_MISMATCH", "Historical payments require their original configured environment.");
    if (before.status === "PAID" || before.hold) return before;
    // tx_ref is persisted/server-generated. Ignore browser success/status/transaction IDs entirely.
    const verified = await runtime.adapter.verify(reference);
    return hostedTransaction(this.pool, async c => {
      const o = await loadHostedOrder(c, reference, true); requireHostedRead(actor, Number(o.school_id));
      const current = await hostedOrderView(c, o);
      if (current.status === "PAID" || current.hold) return current;
      let reason: string | null = null;
      if (verified.reference !== reference || verified.currency !== "NGN" || verified.amountMinor !== 500_000) reason = "PROVIDER_IDENTITY_OR_AMOUNT_MISMATCH";
      try { hostedAmounts(o.bro_profile_id !== null, verified.feeMinor); } catch { reason = "PROVIDER_FEE_REVIEW"; }
      if (reason) await appendHostedEvent(c, o, "RECONCILIATION_HOLD", "hold", {
        transactionId: verified.transactionId, data: { reason, providerStatus: verified.status } });
      else if (verified.status !== "successful") {
        await appendHostedEvent(c, o, verified.status === "failed" ? "VERIFICATION_FAILED" : "VERIFICATION_PENDING",
          `${verified.status}:${verified.transactionId}`, { transactionId: verified.transactionId, data: { status: verified.status } });
      } else {
        const sub = await c.query(`SELECT s.*,t.end_date::text AS current_term_end,t.is_current
          FROM subscriptions s JOIN academic_terms t ON t.id=$2 AND t.school_id=s.school_id
          WHERE s.id=$1 AND s.school_id=$3 AND s.student_id=$4 FOR UPDATE OF s`,
        [o.subscription_id, o.term_id, o.school_id, o.student_id]);
        const s = sub.rows[0];
        if (!s || s.provider_reference && s.provider_reference !== reference && String(s.verification_status).toLowerCase() === "verified") {
          await appendHostedEvent(c, o, "RECONCILIATION_HOLD", "hold", { data: { reason: "SUBSCRIPTION_PAYMENT_CONFLICT" } });
        } else {
          await appendHostedEvent(c, o, "PAYMENT_VERIFIED", "payment-verified", { transactionId: verified.transactionId,
            amount: 500_000, fee: verified.feeMinor, data: { status: "successful", policy: HOSTED_POLICY.code,
              schoolEntitlementMinor:190000,schoolSettlementStatus:"PENDING_SETTLEMENT" } });
          // TEST collections never establish operational LIVE subscription access.
          if (o.environment === "LIVE") {
            await c.query(`UPDATE subscriptions SET status='active',verification_status='verified',provider='flutterwave',
              provider_reference=$1,school_share=1900,partner_profile_id=$2,partner_share=$3,edupulse_share=$4,
              allocation_snapshot=$5::jsonb,expires_at=($6::date+1)::timestamptz
              WHERE id=$7 AND school_id=$8 AND student_id=$9`,
            [reference, o.bro_profile_id, o.bro_profile_id ? 100 : null, o.bro_profile_id ? 3000 : 3100,
              JSON.stringify({ policy: HOSTED_POLICY, collectionModel: "HOSTED_MANUAL", environment: "LIVE",
                schoolId: o.school_id, termId: o.term_id, broProfileId: o.bro_profile_id, ...o.snapshot }),
              o.snapshot.termEnd, o.subscription_id, o.school_id, o.student_id]);
          }
        }
      }
      return hostedOrderView(c, o);
    });
  }
  async settle(actor: HostedActor, reference: string, input: {
    beneficiary: "SCHOOL" | "BRO"; externalReference: string; proofSha256?: string; proofReceiptId?: string;
    settlementDate?: string; ownershipConfirmed: true;
  }) {
    const runtime = await this.runtime();
    if (!actor.owner) throw new HostedPaymentError(403, "OWNER_REQUIRED", "Only the Owner may confirm external settlements.");
    return hostedTransaction(this.pool, async c => {
      const o = await loadHostedOrder(c, reference, true);
      const view = await hostedOrderView(c, o);
      if (o.environment !== runtime.mode || view.status !== "PAID" || view.hold) throw new HostedPaymentError(409, "SETTLEMENT_BLOCKED", "Only an unheld verified payment in its original mode can be settled.");
      let proofSha256 = input.proofSha256;
      let receiptUploader: number | null = null;
      if (input.beneficiary === "SCHOOL") {
        if(view.schoolPayoutClaimed) throw new HostedPaymentError(409,"PAYOUT_ALREADY_RESERVED","A provider transfer is reserved. Reconcile it; do not confirm a second external school transfer.");
        const r=await c.query(`SELECT * FROM payment_receipt_uploads WHERE id=$1 AND state='AVAILABLE' FOR SHARE`,[input.proofReceiptId??null]);
        const receipt=r.rows[0];
        if (!receipt || receipt.kind!=="SCHOOL_SETTLEMENT" || receipt.target_id!==reference ||
          Number(receipt.school_id)!==Number(o.school_id) || Number(receipt.amount_minor)!==190000 ||
          receiptDate(receipt.transfer_date)!==input.settlementDate) {
          throw new HostedPaymentError(400,"SETTLEMENT_RECEIPT_REQUIRED","Attach the completed-transfer receipt for this school, amount and settlement date.");
        }
        const paid=await c.query(`SELECT created_at FROM hosted_checkout_events WHERE order_reference=$1 AND kind='PAYMENT_VERIFIED'`,[reference]);
        const format=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos"});
        if(!input.settlementDate || input.settlementDate>format.format(new Date()) ||
          input.settlementDate<format.format(new Date(paid.rows[0].created_at))) {
          throw new HostedPaymentError(400,"INVALID_SETTLEMENT_DATE","Settlement must be dated after collection and not in the future.");
        }
        proofSha256=receipt.sha256;receiptUploader=Number(receipt.uploaded_by);
      }
      if (input.beneficiary === "BRO") {
        const term = await c.query(`SELECT end_date<(now() AT TIME ZONE 'Africa/Lagos')::date
          AND $3::date<(now() AT TIME ZONE 'Africa/Lagos')::date AS ended
          FROM academic_terms WHERE id=$1 AND school_id=$2`, [o.term_id, o.school_id, o.snapshot.termEnd]);
        if (!o.bro_profile_id || !term.rows[0]?.ended) {
          throw new HostedPaymentError(409, "BRO_TERM_REVIEW_REQUIRED", "A real BRO liability and term-end Owner approval are required.");
        }
      }
      const kind = input.beneficiary === "SCHOOL" ? "SCHOOL_SETTLED" : "BRO_SETTLED";
      const existing = await c.query(`SELECT external_reference,proof_sha256 FROM hosted_checkout_events WHERE order_reference=$1 AND kind=$2`, [reference, kind]);
      if (existing.rows[0]) {
        if (existing.rows[0].external_reference !== input.externalReference || existing.rows[0].proof_sha256 !== proofSha256) {
          throw new HostedPaymentError(409, "SETTLEMENT_ALREADY_RECORDED", "This liability already has a different settlement confirmation.");
        }
        return view;
      }
      await appendHostedEvent(c, o, kind, kind, { actorId: actor.id,
        amount: input.beneficiary === "SCHOOL" ? 190_000 : 10_000,
        externalReference: input.externalReference, proofSha256,
        data: { ownershipConfirmed: input.ownershipConfirmed, approval: "OWNER_EXTERNAL_TRANSFER_CONFIRMATION",
          schoolId: o.school_id, broProfileId: input.beneficiary === "BRO" ? o.bro_profile_id : null,
          receiptId:input.proofReceiptId??null,settlementDate:input.settlementDate??null,receiptUploadedBy:receiptUploader } });
      return hostedOrderView(c, o);
    });
  }
  async webhook(hash: string | undefined, payload: any) {
    const runtime = await this.runtime();
    if (!runtime.adapter.authenticate(hash)) throw new HostedPaymentError(401, "INVALID_WEBHOOK", "Invalid webhook authentication.");
    const reference = String(payload?.data?.tx_ref ?? "");
    if (!/^HCM1_[TL]_[a-f0-9]{32}$/.test(reference)) return { processed: false };
    const system: HostedActor = { id: 0, email: "", owner: true, schoolIds: [] };
    const existing = await this.get(system, reference);
    if (existing.environment !== runtime.mode) throw new HostedPaymentError(409, "MODE_MISMATCH", "Webhook environment mismatch.");
    if (/refund|dispute|chargeback/i.test(String(payload.event ?? ""))) {
      await hostedTransaction(this.pool, async c => { const o = await loadHostedOrder(c, reference, true);
        await appendHostedEvent(c, o, "RECONCILIATION_HOLD", "hold", { data: { reason: "AUTHENTICATED_ADVERSE_EVENT_REQUIRES_REVIEW" } }); });
      return { processed: true, held: true };
    }
    await this.reconcile(system, reference); // Authentication never substitutes for provider verification.
    return { processed: true };
  }
}
