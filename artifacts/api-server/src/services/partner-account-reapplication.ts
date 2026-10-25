import { createHash } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { activeAccessArchives, ACCESS_ARCHIVE_EVENT } from "../../../../scripts/src/production-reset/access-archive.mjs";
import { auditAccountApplication } from "./account-application-audit";
import { assertTestArchiveAccess } from "./test-account-archive-access";
import type { applicationInput } from "./account-applications";
import type { z } from "zod";

type Db = { query: (sql: string, values?: any[]) => Promise<any> };
const normalized = (v: string) => v.trim().toLowerCase();
const conflict = () => new AuthError(409, "An active account or application already uses this email. Reapplication cannot reopen or replace it.");

export async function reapplicationSchemaReady(db: Db) {
  const r = await db.query(`SELECT to_regclass('public.partner_account_reapplications') IS NOT NULL
    AND to_regclass('public.partner_reapplication_sessions') IS NOT NULL AS ready`);
  return r.rows[0]?.ready === true;
}

export async function verifiedReapplicationSession(clerkUserId: string, sessionId: string) {
  const session = await clerkClient.sessions.getSession(sessionId);
  if (session.id !== sessionId || session.userId !== clerkUserId || session.status !== "active"
      || !Number.isSafeInteger(session.createdAt) || session.createdAt <= 0) {
    throw new AuthError(403, "A verified active sign-in session is required.");
  }
  return session.createdAt;
}

// Resolve only explicitly associated sessions. A new association NEVER changes
// the old app_users.clerk_user_id or selects old memberships by email.
export async function resolveReapplicationUser(clerkUserId: string, sessionId?: string) {
  if (!sessionId || !await reapplicationSchemaReady(pool)) return null;
  let found = await pool.query(`SELECT r.id,r.new_user_id FROM partner_reapplication_sessions s
    JOIN partner_account_reapplications r ON r.id=s.reapplication_id
    WHERE s.session_id=$1 AND s.clerk_user_id=$2 AND r.clerk_user_id=$2`, [sessionId,clerkUserId]);
  if (!found.rows[0]) {
    const latest = await pool.query(`SELECT id,new_user_id,created_at FROM partner_account_reapplications
      WHERE clerk_user_id=$1 ORDER BY id DESC LIMIT 1`, [clerkUserId]);
    const r = latest.rows[0];
    if (!r) return null;
    const createdAt = await verifiedReapplicationSession(clerkUserId, sessionId);
    // JWT iat is NOT session creation: refreshing an old JWT never upgrades it.
    if (createdAt <= new Date(r.created_at).getTime()) return null;
    // Do not consume a genuinely new session by attaching it to a revoked
    // generation. It must remain available for an explicit fresh reapplication.
    await assertTestArchiveAccess({ userId:r.new_user_id });
    await pool.query(`INSERT INTO partner_reapplication_sessions(session_id,reapplication_id,clerk_user_id)
      VALUES($1,$2,$3) ON CONFLICT(session_id) DO NOTHING`, [sessionId,r.id,clerkUserId]);
    found = await pool.query(`SELECT r.id,r.new_user_id FROM partner_reapplication_sessions s
      JOIN partner_account_reapplications r ON r.id=s.reapplication_id
      WHERE s.session_id=$1 AND s.clerk_user_id=$2 AND r.clerk_user_id=$2`, [sessionId,clerkUserId]);
  }
  if (!found.rows[0]) throw new AuthError(503, "The new account association could not be verified.");
  const user = (await pool.query(`SELECT id,email,first_name AS "firstName",last_name AS "lastName",phone,status
    FROM app_users WHERE id=$1`, [found.rows[0].new_user_id])).rows[0];
  if (!user) throw new AuthError(503, "The new account association is unavailable.");
  return { ...user, clerkUserId, reapplicationUserId: user.id };
}

export async function eligibleArchivedPartner(db: Db, email: string, clerkUserId: string, excludeUserId = 0) {
  const archives = await activeAccessArchives(db);
  const schools = [...new Set(archives.flatMap(a => a.schoolIds))];
  const partners = [...new Set(archives.flatMap(a => a.partnerIds))];
  const revoked = new Set(archives.flatMap(a => a.userIds));
  if (!archives.some(a => a.emails.includes(email)) || !partners.length) throw conflict();
  const users = (await db.query(`SELECT id,clerk_user_id FROM app_users
    WHERE lower(btrim(email))=$1 AND id<>$2 ORDER BY id`, [email,excludeUserId])).rows;
  if (users.some((u: any) => !revoked.has(u.id) || u.clerk_user_id && u.clerk_user_id !== clerkUserId)) throw conflict();
  const ids = users.map((u: any) => u.id);
  const matching = (await db.query(`SELECT p.id FROM partner_profiles p WHERE p.id=ANY($2::int[]) AND (
    lower(btrim(p.email))=$1 OR p.user_id=ANY($3::int[])
    OR EXISTS(SELECT 1 FROM partner_profile_users pu WHERE pu.partner_profile_id=p.id AND pu.user_id=ANY($3::int[]))
    OR EXISTS(SELECT 1 FROM partner_invitations i WHERE i.partner_profile_id=p.id AND lower(btrim(i.invited_email))=$1))
    ORDER BY p.id`, [email,partners,ids])).rows;
  if (!matching.length) throw conflict();
  const outside = await db.query(`SELECT 1 FROM partner_profiles WHERE lower(btrim(email))=$1
      AND NOT(id=ANY($2::int[])) AND (user_id IS NULL OR user_id<>$5)
    UNION ALL SELECT 1 FROM employees WHERE lower(btrim(email))=$1 AND NOT(school_id=ANY($3::int[]))
    UNION ALL SELECT 1 FROM parents WHERE lower(btrim(email))=$1 AND NOT(school_id=ANY($3::int[]))
    UNION ALL SELECT 1 FROM students WHERE lower(btrim(COALESCE(to_jsonb(students)->>'email','')))=$1 AND NOT(school_id=ANY($3::int[]))
    UNION ALL SELECT 1 FROM platform_company_employees WHERE lower(btrim(email))=$1
    UNION ALL SELECT 1 FROM school_memberships WHERE user_id=ANY($4::int[])
      AND (school_id IS NOT NULL AND NOT(school_id=ANY($3::int[])) OR school_id IS NULL AND role<>'PARTNER')
    UNION ALL SELECT 1 FROM partner_invitations WHERE lower(btrim(invited_email))=$1
      AND NOT(partner_profile_id=ANY($2::int[])) AND status='ACTIVE'
    UNION ALL SELECT 1 FROM account_applications WHERE lower(btrim(email))=$1
      AND user_id<>$5 AND NOT(user_id=ANY($4::int[])) LIMIT 1`, [email,partners,schools,ids,excludeUserId]);
  if (outside.rows.length) throw conflict();
  const batchIds = archives.filter(a => a.emails.includes(email) || a.userIds.some((id: number) => ids.includes(id)))
    .map(a => a.batchId);
  const blocked = (await db.query(`SELECT max(timestamp) AS blocked_at FROM audit_logs
    WHERE event_type=$1 AND module='Security' AND role='PLATFORM_OWNER'
      AND metadata->>'operation'='BLOCK' AND metadata->>'batchId'=ANY($2::text[])`, [ACCESS_ARCHIVE_EVENT,batchIds])).rows[0];
  if (!blocked?.blocked_at) throw new AuthError(503, "The archive sign-in boundary could not be verified.");
  return { ids, partnerIds: matching.map((r: any) => r.id), batchIds, blockedAt: new Date(blocked.blocked_at).getTime() };
}

export async function submitPartnerReapplication(
  clerkUserId: string, sessionId: string, input: z.infer<typeof applicationInput>,
) {
  if (input.applicantType !== "PARTNER") throw new AuthError(400, "This path accepts a new Business Relationship Officer (BRO) application only.");
  const identity = await clerkClient.users.getUser(clerkUserId);
  const primary = identity.emailAddresses.find(e => e.id === identity.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== "verified" || normalized(primary.emailAddress) !== input.email) {
    throw new AuthError(403, "Verify and use your current primary sign-in email.");
  }
  const createdAt = await verifiedReapplicationSession(clerkUserId, sessionId);
  const requestDigest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!await reapplicationSchemaReady(client)) throw new AuthError(503, "BRO reapplication requires the reviewed account-isolation migration.");
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SELECT pg_advisory_xact_lock(192837465,20261025)");
    // Serialize against all existing account/application creation paths, not
    // merely another reapplication. Provider verification already finished.
    await client.query(`LOCK TABLE app_users,school_memberships,partner_profiles,partner_profile_users,
      partner_invitations,employees,parents,students,platform_company_employees,account_applications
      IN SHARE ROW EXCLUSIVE MODE`);
    const prior = (await client.query(`SELECT r.request_digest,r.new_user_id,a.id,a.status FROM partner_account_reapplications r
      JOIN account_applications a ON a.reapplication_id=r.id
      WHERE r.clerk_user_id=$1 AND r.initial_session_id=$2`, [clerkUserId,sessionId])).rows[0];
    if (prior) {
      await assertTestArchiveAccess({ userId:prior.new_user_id,email:input.email,reapplicationUserId:prior.new_user_id },client);
      if (prior.request_digest !== requestDigest || prior.status !== "PENDING") throw conflict();
      await client.query("ROLLBACK");
      return prior.id as number; // Recover a lost response; do not create again.
    }
    const source = await eligibleArchivedPartner(client,input.email,clerkUserId);
    if (createdAt <= source.blockedAt) throw new AuthError(403,
      "Sign out and sign in again before submitting a new BRO application. Your previous account will stay archived.",
      "REAPPLICATION_FRESH_SIGN_IN_REQUIRED");
    const [firstName,...surname] = input.fullName.split(" ");
    const user = (await client.query(`INSERT INTO app_users(clerk_user_id,email,first_name,last_name,phone)
      VALUES(NULL,$1,$2,$3,$4) RETURNING id`, [input.email,firstName,surname.join(" ") || null,input.phone])).rows[0];
    const record = (await client.query(`INSERT INTO partner_account_reapplications
      (new_user_id,clerk_user_id,email,initial_session_id,previous_user_ids,previous_partner_ids,archive_batch_ids,request_digest)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [user.id,clerkUserId,input.email,sessionId,source.ids,source.partnerIds,source.batchIds,requestDigest])).rows[0];
    await client.query(`INSERT INTO partner_reapplication_sessions(session_id,reapplication_id,clerk_user_id)
      VALUES($1,$2,$3)`, [sessionId,record.id,clerkUserId]);
    const a = (await client.query(`INSERT INTO account_applications
      (user_id,reapplication_id,applicant_type,first_name,last_name,email,phone,city,state,business_name,address,partner_type)
      VALUES($1,$2,'PARTNER',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [user.id,record.id,firstName,surname.join(" "),input.email,input.phone,input.city ?? "",input.state ?? "",
      input.businessName ?? null,input.address ?? null,input.partnerType])).rows[0];
    await auditAccountApplication(client,{ user: { id: user.id,clerkUserId,email: input.email,
      firstName,lastName: surname.join(" "),phone: input.phone,status: "ACTIVE" },roles: [] },
    a.id,"Submitted account application",{ applicantType:"PARTNER",status:"PENDING",reapplication:true });
    await client.query("COMMIT");
    return a.id as number;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as any).code === "23505") throw conflict();
    throw error;
  } finally { client.release(); }
}
