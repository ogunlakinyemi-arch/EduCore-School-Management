import { randomUUID } from "node:crypto";
import {issueEmployeeReplacement} from "./employee-card-replacement";
import type { Request } from "express";
import { pool } from "@workspace/db";
import { AuthError, getUserContext, isPlatformOwner, assertRoles } from "../middlewares/auth";
import { markSecurityCardLost } from "./school-security-core-service";
import { configuredTestAdapter } from "../lib/fee-providers/factory";
import { settleVerifiedPayment } from "../routes/fee-provider-webhooks";
import { emitDomainParentEvent } from "./communication-service";

export const REPLACEMENT_AMOUNT_MINOR = 200_000;
type Sql = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };

export function replacementScope(req: Request, studentAlias = "s", schoolAlias = studentAlias) {
  const context = getUserContext(req);
  if (isPlatformOwner(context)) return { clause: "TRUE", values: [] as any[] };
  const adminSchools = context.roles.filter(r => r.role === "SCHOOL_ADMIN" && r.schoolId != null).map(r => r.schoolId);
  return {
    clause: `(${schoolAlias}.school_id=ANY($1::integer[])
      OR (${studentAlias}.user_id=$2 AND EXISTS (SELECT 1 FROM school_memberships m
         WHERE m.user_id=$2 AND m.school_id=${studentAlias}.school_id AND m.role='STUDENT' AND m.status='ACTIVE'))
      OR EXISTS (SELECT 1 FROM parents p JOIN parent_student_relationships rel
         ON rel.parent_id=p.id
         JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=p.school_id
         WHERE p.user_id=$2 AND p.school_id=${studentAlias}.school_id AND rel.student_id=${studentAlias}.id
           AND p.status='ACTIVE' AND rel.status='ACTIVE' AND m.role='PARENT' AND m.status='ACTIVE'))`,
    values: [adminSchools, context.user.id],
  };
}

const paymentEvidence = `i.currency='NGN' AND i.subtotal_minor=200000 AND i.total_minor=200000
  AND i.discount_minor=0 AND i.waiver_minor=0 AND i.status='PAID' AND i.paid_minor=200000
  AND i.outstanding_minor=0 AND
  (SELECT COALESCE(SUM(p.amount_minor),0) FROM fee_payments p
    JOIN fee_receipts receipt ON receipt.payment_id=p.id AND receipt.school_id=p.school_id
    WHERE p.invoice_id=i.id AND p.school_id=i.school_id AND p.student_id IS NOT DISTINCT FROM r.student_id
      AND p.employee_id IS NOT DISTINCT FROM r.employee_id
      AND p.currency='NGN' AND p.status='VERIFIED'
      AND (p.method<>'BANK_TRANSFER' OR p.verification_evidence_ref IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM fee_refunds refund WHERE refund.payment_id=p.id
        AND refund.school_id=p.school_id AND refund.status IN ('PENDING','APPROVED','PROCESSING','COMPLETED','RECONCILIATION_REQUIRED'))) = 200000`;

const replacementSelect = `SELECT r.id,r.school_id AS "schoolId",r.student_id AS "studentId",
  r.employee_id AS "employeeId",
  CASE WHEN r.employee_id IS NULL THEN 'STUDENT' WHEN UPPER(e.employee_type) LIKE 'TEACH%' THEN 'TEACHER' ELSE 'STAFF' END AS "cardholderType",
  trim(concat_ws(' ',COALESCE(s.first_name,e.first_name),COALESCE(s.last_name,e.last_name))) AS "studentName",r.old_card_id AS "oldCardId",
  r.invoice_id AS "invoiceId",r.status,CASE WHEN ${paymentEvidence} THEN 'PAID' ELSE 'UNPAID' END AS "paymentStatus",
  200000 AS "amountMinor",i.outstanding_minor AS "outstandingMinor",r.new_card_id AS "newCardId",r.created_at AS "createdAt"
  FROM student_nfc_replacement_requests r LEFT JOIN students s ON s.id=r.student_id AND s.school_id=r.school_id
  LEFT JOIN employees e ON e.id=r.employee_id AND e.school_id=r.school_id
  JOIN fee_invoices i ON i.id=r.invoice_id AND i.school_id=r.school_id`;

async function audit(db: Sql, req: Request, schoolId: number, requestId: number, event: string, metadata: any) {
  const c = getUserContext(req);
  await db.query(`INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,event_type,result,metadata)
    VALUES($1,$2,$3,$4,$5,$6,'NFC Cards',$7,$6,'SUCCESS',$8)`,
  [c.user.email, c.roles[0]?.role ?? "AUTHENTICATED", c.user.id, c.user.clerkUserId, schoolId, event, requestId, metadata]);
}

export async function readReplacement(req: Request, id: number, db: Sql = pool) {
  const scope = replacementScope(req,"s","r");
  const result = await db.query(`${replacementSelect} WHERE ${scope.clause} AND r.id=$${scope.values.length + 1}`, [...scope.values,id]);
  if (!result.rows[0]) throw new AuthError(404, "Replacement request not found");
  return result.rows[0];
}

export async function listReplacements(req: Request, schoolId?: number) {
  const scope = replacementScope(req,"s","r");
  const filter = schoolId ? ` AND r.school_id=$${scope.values.length + 1}` : "";
  const values = schoolId ? [...scope.values,schoolId] : scope.values;
  const requests = await pool.query(`${replacementSelect} WHERE ${scope.clause}${filter} ORDER BY r.id DESC LIMIT 200`, values);
  const cardScope=replacementScope(req,"s","c");
  const cardFilter=schoolId ? ` AND c.school_id=$${cardScope.values.length+1}` : "";
  const cards = await pool.query(`SELECT c.id,c.school_id AS "schoolId",c.student_id AS "studentId",e.id AS "employeeId",
    CASE WHEN e.id IS NULL THEN 'STUDENT' WHEN UPPER(e.employee_type) LIKE 'TEACH%' THEN 'TEACHER' ELSE 'STAFF' END AS "cardholderType",
    trim(concat_ws(' ',COALESCE(s.first_name,e.first_name),COALESCE(s.last_name,e.last_name))) AS "studentName",c.status
    FROM nfc_cards c LEFT JOIN students s ON s.id=c.student_id AND s.school_id=c.school_id
    LEFT JOIN employee_nfc_card_bindings b ON b.nfc_card_id=c.id AND b.school_id=c.school_id
    LEFT JOIN employees e ON e.id=b.employee_id AND e.school_id=b.school_id
    WHERE ${cardScope.clause}${cardFilter} AND (s.id IS NOT NULL OR e.id IS NOT NULL) AND lower(c.status) IN ('active','locked','lost','blocked','suspended','inactive')
      AND c.replaced_by_card_id IS NULL ORDER BY c.id DESC LIMIT 200`, values);
  return { requests: requests.rows, cards: cards.rows };
}

async function authorizedCard(req: Request, cardId: number, db: Sql = pool, lock = false) {
  const scope = replacementScope(req,"s","c");
  const result = await db.query(`SELECT c.*,COALESCE(s.first_name,e.first_name) first_name,COALESCE(s.last_name,e.last_name) last_name,
      COALESCE(s.admission_no,e.employee_no) admission_no,s.section,e.id employee_id,e.employment_status
    FROM nfc_cards c LEFT JOIN students s ON s.id=c.student_id AND s.school_id=c.school_id
    LEFT JOIN employee_nfc_card_bindings b ON b.nfc_card_id=c.id AND b.school_id=c.school_id
    LEFT JOIN employees e ON e.id=b.employee_id AND e.school_id=b.school_id
    WHERE ${scope.clause} AND (s.id IS NOT NULL OR e.id IS NOT NULL)
      AND c.id=$${scope.values.length + 1}${lock ? " FOR UPDATE OF c" : ""}`, [...scope.values,cardId]);
  if (!result.rows[0]) throw new AuthError(404, "Cardholder not found");
  return result.rows[0];
}

export async function requestReplacement(req: Request, cardId: number, reason: string) {
  if (reason.trim().length < 3 || reason.length > 500) throw new AuthError(400,"A reason between 3 and 500 characters is required");
  const card = await authorizedCard(req, cardId);
  if(card.employee_id!=null && (isPlatformOwner(getUserContext(req)) ||
    !getUserContext(req).roles.some(r=>r.role==="SCHOOL_ADMIN"&&r.schoolId===card.school_id))) throw new AuthError(403,"Only the cardholder's School Admin may request an employee replacement");
  if(card.employee_id!=null && String(card.employment_status).toUpperCase()!=="ACTIVE") throw new AuthError(409,"The employee must be active before requesting a replacement");
  if (card.replaced_by_card_id != null || ["replaced","expired","unassigned"].includes(String(card.status).toLowerCase())) {
    const existing = await pool.query("SELECT id FROM student_nfc_replacement_requests WHERE old_card_id=$1", [cardId]);
    if (existing.rows[0]) return readReplacement(req, existing.rows[0].id);
    throw new AuthError(409, "This card is not eligible for replacement");
  }
  // Revocation is committed first: even a missing finance period must not leave a lost UID usable.
  await markSecurityCardLost(req, card.school_id, cardId, reason, card.student_id==null?undefined:Number(card.student_id));
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const locked = await authorizedCard(req, cardId, db, true);
    const prior = await db.query("SELECT id FROM student_nfc_replacement_requests WHERE old_card_id=$1", [cardId]);
    if (prior.rows[0]) {
      const result = await readReplacement(req, prior.rows[0].id, db);
      await db.query("COMMIT");
      return result;
    }
    if (locked.status !== "lost" || locked.replaced_by_card_id != null) throw new AuthError(409, "Card state changed; refresh before requesting");
    const period = await db.query(`SELECT t.id AS term_id,t.academic_session_id AS session_id
      FROM academic_terms t JOIN academic_sessions a ON a.id=t.academic_session_id AND a.school_id=t.school_id
      WHERE t.school_id=$1 AND t.is_current AND a.is_current ORDER BY t.id DESC LIMIT 1`, [locked.school_id]);
    if (!period.rows[0]) throw new AuthError(409, "Card revoked. Configure the school's current academic session and term to create the replacement invoice.");
    const actor = getUserContext(req);
    const invoice = await db.query(`INSERT INTO fee_invoices
      (school_id,student_id,academic_session_id,academic_term_id,invoice_number,student_name_snapshot,
       admission_no_snapshot,class_name_snapshot,section_snapshot,issue_date,due_date,currency,
       subtotal_minor,total_minor,outstanding_minor,created_by,employee_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,'NFC replacement (not tuition)',$8,CURRENT_DATE,CURRENT_DATE,'NGN',200000,200000,200000,$9,$10)
      RETURNING id`,
    [locked.school_id,locked.student_id,period.rows[0].session_id,period.rows[0].term_id,
      `NFC-REPLACEMENT-${randomUUID()}`,`${locked.first_name} ${locked.last_name}`,locked.admission_no ?? "",
      locked.section ?? "",actor.user.id,locked.employee_id??null]);
    const invoiceId = invoice.rows[0].id;
    await db.query(`INSERT INTO fee_invoice_lines(school_id,invoice_id,category_name_snapshot,description_snapshot,amount_minor)
      VALUES($1,$2,'NFC card replacement','One-time lost/stolen physical-card replacement; not school fees or NFC subscription',200000)`, [locked.school_id,invoiceId]);
    const inserted = await db.query(`INSERT INTO student_nfc_replacement_requests
      (school_id,student_id,old_card_id,invoice_id,requested_by,reason,employee_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [locked.school_id,locked.student_id,cardId,invoiceId,actor.user.id,reason,locked.employee_id??null]);
    const id = inserted.rows[0].id;
    await audit(db,req,locked.school_id,id,"NFC_REPLACEMENT_REQUESTED",{ oldCardId: cardId, invoiceId, amountMinor: REPLACEMENT_AMOUNT_MINOR });
    await db.query(`INSERT INTO platform_notifications(recipient_user_id,title,message,severity)
      SELECT DISTINCT m.user_id,'NFC replacement requested',$1,'info' FROM school_memberships m
      JOIN app_users u ON u.id=m.user_id WHERE m.school_id IS NULL AND m.role='PLATFORM_OWNER'
        AND m.status='ACTIVE' AND UPPER(u.status)='ACTIVE'`,
    [`School ${locked.school_id}: replacement request ${id}, card reference ${cardId}. NGN 2,000 payment is required before Owner issuance.`]);
    const result = await readReplacement(req,id,db);
    await db.query("COMMIT");
    return result;
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

export async function verifyReplacementPayment(req: Request, id: number, providerTransactionId: string) {
  const request = await readReplacement(req,id);
  if (request.paymentStatus === "PAID") return request;
  const result = await pool.query(`SELECT p.* FROM fee_payments p JOIN fee_provider_checkout_sessions cs
    ON cs.payment_id=p.id AND cs.school_id=p.school_id
    WHERE p.invoice_id=$1 AND p.school_id=$2 AND p.provider='FLUTTERWAVE'
       AND p.amount_minor>0 AND p.amount_minor<=200000 AND p.currency='NGN' AND cs.state IN ('INITIALIZING','READY','FAILED')
      ORDER BY p.id DESC LIMIT 1`, [request.invoiceId,request.schoolId]);
  const payment = result.rows[0];
  if (!payment) throw new AuthError(409, "Initialize the existing Flutterwave invoice checkout first");
  let adapter;
  try { adapter = configuredTestAdapter("FLUTTERWAVE"); }
  catch { throw new AuthError(503,"Flutterwave TEST verification is unavailable"); }
  if (!adapter) throw new AuthError(503,"Flutterwave TEST verification is unavailable");
  const verified = await adapter.verifyPayment({ reference: payment.reference, amountMinor: Number(payment.amount_minor), currency: "NGN", providerTransactionId });
  await settleVerifiedPayment("FLUTTERWAVE",`replacement:${verified.providerTransactionId}:${verified.status}`,verified,
    Buffer.from(JSON.stringify({ source: "replacement-verification", transactionId: verified.providerTransactionId })),
    "ADMIN_RECONCILIATION");
  return readReplacement(req,id);
}

export async function issueReplacement(req: Request, id: number, uid: string) {
  assertRoles(req,["PLATFORM_OWNER"]);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const rows = await db.query(`SELECT * FROM student_nfc_replacement_requests WHERE id=$1 FOR UPDATE`, [id]);
    const request = rows.rows[0];
    if (!request) throw new AuthError(404,"Replacement request not found");
    if (request.status === "ISSUED") {
      const current = await db.query("SELECT uid FROM nfc_cards WHERE id=$1", [request.new_card_id]);
      if (String(current.rows[0]?.uid).toLowerCase() !== uid.toLowerCase()) throw new AuthError(409,"Replacement was already issued with a different UID");
      const result = await readReplacement(req,id,db); await db.query("COMMIT"); return result;
    }
    // Serialize against existing invoice refunds, adjustments and verification.
    await db.query("SELECT id FROM fee_invoices WHERE id=$1 AND school_id=$2 FOR UPDATE", [request.invoice_id,request.school_id]);
    const evidence = await readReplacement(req,id,db);
    if (evidence.paymentStatus !== "PAID") throw new AuthError(409,"A verified NGN 2,000 replacement payment and receipt are required");
    if(request.employee_id!=null) {
      await issueEmployeeReplacement(db,req,request,uid);
      await audit(db,req,request.school_id,id,"NFC_REPLACEMENT_ISSUED",{employeeId:request.employee_id,oldCardId:request.old_card_id,invoiceId:request.invoice_id});
      const result=await readReplacement(req,id,db);await db.query("COMMIT");return result;
    }
    await db.query("SELECT id FROM students WHERE id=$1 AND school_id=$2 FOR UPDATE", [request.student_id,request.school_id]);
    const oldResult = await db.query("SELECT * FROM nfc_cards WHERE id=$1 AND school_id=$2 FOR UPDATE", [request.old_card_id,request.school_id]);
    const old = oldResult.rows[0];
    if (!old || Number(old.student_id) !== Number(request.student_id) || old.replaced_by_card_id != null || !["lost","blocked","inactive","suspended"].includes(old.status)) throw new AuthError(409,"Old card identity or revocation state changed");
    await db.query("SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))", [uid]);
    const targetResult = await db.query("SELECT * FROM nfc_cards WHERE lower(uid)=lower($1) FOR UPDATE", [uid]);
    const target = targetResult.rows[0];
    if (!target || target.school_id !== request.school_id || target.student_id != null || target.status !== "unassigned" || target.id === old.id) throw new AuthError(409,"Select a different prepared, unassigned UID from this school");
    const used = await db.query(`SELECT 1 FROM nfc_card_history WHERE nfc_card_id=$1 AND student_id IS NOT NULL
      UNION ALL SELECT 1 FROM employee_nfc_card_bindings WHERE nfc_card_id=$1
      UNION ALL SELECT 1 FROM nfc_cards WHERE student_id=$2 AND school_id=$3 AND id<>$4 AND status IN ('active','locked') LIMIT 1`,
    [target.id,request.student_id,request.school_id,old.id]);
    if (used.rows[0]) throw new AuthError(409,"UID has person history or this student already has another live assignment");
    const actorId = getUserContext(req).user.id;
    // Existing subscription enforcement still applies to device reads; replacement never edits it.
    await db.query(`UPDATE nfc_cards SET student_id=$1,status='active',issued_at=NOW(),activated_at=NOW()
      WHERE id=$2 AND school_id=$3`, [request.student_id,target.id,request.school_id]);
    await db.query(`UPDATE nfc_cards SET status='replaced',replaced_at=NOW(),replaced_by_card_id=$1,
      replaced_by_school_id=$2,deactivated_at=COALESCE(deactivated_at,NOW()) WHERE id=$3`, [target.id,request.school_id,old.id]);
    await db.query(`INSERT INTO nfc_card_history
      (school_id,nfc_card_id,student_id,action,previous_status,new_status,replaced_by_card_id,reason,actor_user_id)
      VALUES($1,$2,$3,'REPLACED',$4,'replaced',$5,$6,$7),
            ($1,$5,$3,'ASSIGNED_AS_REPLACEMENT','unassigned','active',NULL,$6,$7)`,
    [request.school_id,old.id,request.student_id,old.status,target.id,`Replacement request ${id}; old card reference ${old.id}`,actorId]);
    await db.query(`UPDATE student_nfc_replacement_requests SET status='ISSUED',new_card_id=$1,issued_by=$2,issued_at=NOW() WHERE id=$3`, [target.id,actorId,id]);
    await audit(db,req,request.school_id,id,"NFC_REPLACEMENT_ISSUED",{ oldCardId: old.id,newCardId: target.id,invoiceId: request.invoice_id });
    await emitDomainParentEvent(db as any,{ schoolId: request.school_id,studentId: request.student_id,
      eventType:"SECURITY_CARD_LOST",eventId:`replacement:${id}:issued`,category:"SECURITY",
      subject:"Your child's replacement school card has been issued",body:"The old card remains permanently revoked. The replacement uses the same student identity.",
      privacy:"PARENT_SAFE",link:"/card-replacements",channels:["IN_APP"] });
    const result = await readReplacement(req,id,db);
    await db.query("COMMIT"); return result;
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}