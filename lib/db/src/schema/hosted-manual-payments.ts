import { sql } from "drizzle-orm";
import { pgTable, text, integer, jsonb, timestamp, uniqueIndex, check, foreignKey, index } from "drizzle-orm/pg-core";
import { appUsers, schools, students, subscriptions, academicTerms, partnerProfiles } from "./edupulse";

// Additive, separate journal: no historic subscription/provider records are relabelled.
export const hostedCheckoutOrders = pgTable("hosted_checkout_orders", {
  reference: text("reference").primaryKey(),
  environment: text("environment").notNull(),
  provider: text("provider").notNull().default("FLUTTERWAVE"),
  policy: text("policy").notNull().default("HOSTED_MANUAL_V1"),
  subscriptionId: integer("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "restrict" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "restrict" }),
  termId: integer("term_id").notNull().references(() => academicTerms.id, { onDelete: "restrict" }),
  payerUserId: integer("payer_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  broProfileId: integer("bro_profile_id").references(() => partnerProfiles.id, { onDelete: "restrict" }),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("hosted_orders_reference_environment_uq").on(t.reference, t.environment),
  uniqueIndex("hosted_orders_student_term_environment_uq").on(t.schoolId, t.studentId, t.termId, t.environment),
  uniqueIndex("hosted_orders_payer_idempotency_uq").on(t.payerUserId, t.environment, t.idempotencyKey),
  check("hosted_orders_mode_ck", sql`${t.environment} IN ('TEST','LIVE')`),
  check("hosted_orders_provider_policy_ck", sql`${t.provider}='FLUTTERWAVE' AND ${t.policy}='HOSTED_MANUAL_V1'`),
  check("hosted_orders_reference_ck", sql`${t.reference} ~ '^HCM1_[TL]_[a-f0-9]{32}$'`),
  check("hosted_orders_reference_mode_ck", sql`(${t.environment}='TEST' AND ${t.reference} LIKE 'HCM1_T_%')
    OR (${t.environment}='LIVE' AND ${t.reference} LIKE 'HCM1_L_%')`),
]);
export const hostedCheckoutEvents = pgTable("hosted_checkout_events", {
  id: text("id").primaryKey(),
  orderReference: text("order_reference").notNull(),
  environment: text("environment").notNull(),
  kind: text("kind").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  providerTransactionId: text("provider_transaction_id"),
  amountMinor: integer("amount_minor"),
  feeMinor: integer("fee_minor"),
  externalReference: text("external_reference"),
  proofSha256: text("proof_sha256"),
  actorId: integer("actor_id").references(() => appUsers.id, { onDelete: "restrict" }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ columns: [t.orderReference, t.environment],
    foreignColumns: [hostedCheckoutOrders.reference, hostedCheckoutOrders.environment],
    name: "hosted_events_order_environment_fk" }).onDelete("restrict"),
  uniqueIndex("hosted_events_idempotency_uq").on(t.orderReference, t.idempotencyKey),
  uniqueIndex("hosted_events_economic_once_uq").on(t.orderReference, t.kind)
    .where(sql`${t.kind} IN ('CHECKOUT_CLAIMED','CHECKOUT_READY','PAYMENT_VERIFIED','RECONCILIATION_HOLD','SCHOOL_SETTLED','BRO_SETTLED',
      'SCHOOL_PAYOUT_CLAIMED','SCHOOL_PAYOUT_ACCEPTED','SCHOOL_PAYOUT_SUCCESS','SCHOOL_PAYOUT_FAILED','SCHOOL_PAYOUT_RECEIPT')`),
  uniqueIndex("hosted_events_provider_payment_uq").on(t.environment, t.providerTransactionId)
    .where(sql`${t.kind}='PAYMENT_VERIFIED'`),
  uniqueIndex("hosted_events_payout_reference_uq").on(t.environment,t.externalReference)
    .where(sql`${t.kind}='SCHOOL_PAYOUT_CLAIMED'`),
  uniqueIndex("hosted_events_payout_transfer_uq").on(t.environment,t.providerTransactionId)
    .where(sql`${t.kind}='SCHOOL_PAYOUT_SUCCESS'`),
  uniqueIndex("hosted_events_external_transfer_uq").on(t.environment, t.externalReference)
    .where(sql`${t.kind} IN ('SCHOOL_SETTLED','BRO_SETTLED','SCHOOL_PAYOUT_SUCCESS')`),
  index("hosted_events_order_created_idx").on(t.orderReference, t.createdAt),
  check("hosted_events_kind_ck", sql`${t.kind} IN ('CHECKOUT_CLAIMED','CHECKOUT_READY','CHECKOUT_UNKNOWN','PAYMENT_VERIFIED',
    'VERIFICATION_PENDING','VERIFICATION_FAILED','RECONCILIATION_HOLD','SCHOOL_SETTLED','BRO_SETTLED',
    'SCHOOL_PAYOUT_CLAIMED','SCHOOL_PAYOUT_ACCEPTED','SCHOOL_PAYOUT_UNCERTAIN','SCHOOL_PAYOUT_STATUS',
    'SCHOOL_PAYOUT_SUCCESS','SCHOOL_PAYOUT_FAILED','SCHOOL_PAYOUT_RECEIPT')`),
  check("hosted_events_amount_ck", sql`(${t.kind}<>'PAYMENT_VERIFIED' OR (${t.amountMinor} IS NOT NULL AND ${t.amountMinor}=500000 AND ${t.providerTransactionId} IS NOT NULL))
    AND (${t.kind}<>'SCHOOL_SETTLED' OR (${t.amountMinor} IS NOT NULL AND ${t.amountMinor}=190000))
    AND (${t.kind}<>'BRO_SETTLED' OR (${t.amountMinor} IS NOT NULL AND ${t.amountMinor}=10000))
    AND (${t.feeMinor} IS NULL OR ${t.feeMinor} BETWEEN 0 AND 309999
      OR (${t.kind} IN ('SCHOOL_PAYOUT_SUCCESS','SCHOOL_PAYOUT_FAILED') AND ${t.feeMinor}>=0))`),
  check("hosted_events_proof_ck", sql`${t.kind} NOT IN ('SCHOOL_SETTLED','BRO_SETTLED') OR (
    ${t.actorId} IS NOT NULL AND ${t.externalReference} IS NOT NULL AND ${t.proofSha256} IS NOT NULL
    AND length(${t.externalReference}) BETWEEN 4 AND 120
    AND ${t.proofSha256} ~ '^[a-f0-9]{64}$')`),
  check("hosted_events_payout_amount_ck",sql`${t.kind} NOT IN ('SCHOOL_PAYOUT_CLAIMED','SCHOOL_PAYOUT_SUCCESS','SCHOOL_PAYOUT_FAILED')
    OR (${t.amountMinor} IS NOT NULL AND ${t.amountMinor}=190000 AND ${t.actorId} IS NOT NULL AND ${t.externalReference} IS NOT NULL)`),
]);
