import { Router, type Request, type NextFunction } from "express";
import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { AuthError, assertRoles, getUserContext, requireAuthentication } from "../middlewares/auth";

const router = Router();
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const secret = () => {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("SESSION_SECRET is required for payout account encryption");
  return crypto.createHash("sha256").update(key).digest();
};
const encrypt = (value: string) => {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${ciphertext.toString("base64")}.${cipher.getAuthTag().toString("base64")}`;
};
const mask = (value: string | null) => value ? `****${value.slice(-4)}` : null;
const run = (fn: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) => fn(req, res).catch(next);
const partnerSelect = `
 p.id, 'PARTNER-' || lpad(p.id::text, 6, '0') AS "partnerCode",
 'INDIVIDUAL' AS "partnerType", p.display_name AS "fullName", NULL::text AS "businessName",
 u.email, u.phone, NULL::text AS address, NULL::text AS state, NULL::text AS lga,
 p.status, u.clerk_user_id AS "clerkUserId", p.user_id AS "userId",
 p.created_at AS "registrationDate", p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
async function profile(req: Request) {
  const c = getUserContext(req);
  const r = await pool.query(`SELECT ${partnerSelect} FROM partner_profiles p JOIN app_users u ON u.id=p.user_id
    WHERE p.user_id=$1 AND p.status IN ('ACTIVE','INVITED','SUSPENDED')`, [c.user.id]);
  if (!r.rows[0] || r.rows[0].status !== "ACTIVE") throw new AuthError(403, "Partner account is not active");
  return r.rows[0];
}
function id(req: Request) { const n = Number(req.params.partnerId); if (!Number.isInteger(n) || n < 1) throw new AuthError(404, "Partner not found"); return n; }

router.use(requireAuthentication());

router.get("/platform/partners", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const values: unknown[] = []; const where: string[] = [];
  if (req.query.status) { values.push(req.query.status); where.push(`p.status=$${values.length}`); }
  if (req.query.search) { values.push(`%${req.query.search}%`); where.push(`(p.display_name ILIKE $${values.length} OR u.email ILIKE $${values.length})`); }
  const r = await pool.query(`SELECT ${partnerSelect} FROM partner_profiles p JOIN app_users u ON u.id=p.user_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.id DESC`, values);
  res.json(r.rows);
}));

router.post("/platform/partners/invitations", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const { email, fullName, phone } = req.body ?? {};
  if (typeof email !== "string" || typeof fullName !== "string") throw new AuthError(400, "email and fullName are required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const u = await client.query(`INSERT INTO app_users (clerk_user_id,email,first_name,phone,status)
      VALUES ($1,$2,$3,$4,'ACTIVE') ON CONFLICT (clerk_user_id) DO UPDATE SET email=EXCLUDED.email,phone=EXCLUDED.phone
      RETURNING id`, [`pending-partner:${crypto.randomUUID()}`, email, fullName, phone ?? null]);
    const p = await client.query(`INSERT INTO partner_profiles (user_id,display_name,status) VALUES ($1,$2,'INVITED') RETURNING id`, [u.rows[0].id, fullName]);
    const token = crypto.randomBytes(32).toString("base64url");
    const t = await client.query(`INSERT INTO partner_referral_tokens(partner_profile_id,token_hash,token_type,expires_at)
      VALUES($1,$2,'INVITATION',NOW()+INTERVAL '7 days') RETURNING id,expires_at,created_at`, [p.rows[0].id, hash(token)]);
    await client.query("COMMIT");
    res.status(201).json({ id: t.rows[0].id, partnerId: p.rows[0].id, email, status: "PENDING", expiresAt: t.rows[0].expires_at, createdAt: t.rows[0].created_at });
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}));

router.get("/platform/partners/:partnerId", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]); const r = await pool.query(`SELECT ${partnerSelect} FROM partner_profiles p JOIN app_users u ON u.id=p.user_id WHERE p.id=$1`, [id(req)]);
  if (!r.rows[0]) throw new AuthError(404, "Partner not found"); res.json(r.rows[0]);
}));
router.patch("/platform/partners/:partnerId/status", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]); const status = req.body?.status;
  if (!["INVITED","ACTIVE","SUSPENDED","DEACTIVATED"].includes(status)) throw new AuthError(400, "Invalid partner status");
  const r = await pool.query(`UPDATE partner_profiles SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id`, [status,id(req)]);
  if (!r.rows[0]) throw new AuthError(404, "Partner not found");
  const out = await pool.query(`SELECT ${partnerSelect} FROM partner_profiles p JOIN app_users u ON u.id=p.user_id WHERE p.id=$1`, [r.rows[0].id]); res.json(out.rows[0]);
}));

router.post("/partner/invitations/:invitationId/accept", run(async (req, res) => {
  const c = getUserContext(req); const invitationId = Number(req.params.invitationId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(`SELECT t.id,t.partner_profile_id,p.status,t.expires_at FROM partner_referral_tokens t JOIN partner_profiles p ON p.id=t.partner_profile_id
      WHERE t.id=$1 AND t.token_type='INVITATION' AND t.status='ACTIVE' FOR UPDATE`, [invitationId]);
    if (!t.rows[0] || t.rows[0].expires_at < new Date()) throw new AuthError(400, "Invitation is expired or revoked");
    await client.query(`UPDATE partner_profiles SET user_id=$1,status='ACTIVE',updated_at=NOW() WHERE id=$2`, [c.user.id,t.rows[0].partner_profile_id]);
    await client.query(`INSERT INTO partner_profile_users(partner_profile_id,user_id,role,status) VALUES($1,$2,'PARTNER','ACTIVE')
      ON CONFLICT (partner_profile_id,user_id) DO UPDATE SET status='ACTIVE'`, [t.rows[0].partner_profile_id,c.user.id]);
    await client.query(`UPDATE partner_referral_tokens SET status='REDEEMED',redeemed_at=NOW() WHERE id=$1`, [invitationId]);
    await client.query("COMMIT");
    const out = await pool.query(`SELECT ${partnerSelect} FROM partner_profiles p JOIN app_users u ON u.id=p.user_id WHERE p.id=$1`, [t.rows[0].partner_profile_id]); res.json(out.rows[0]);
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}));

router.post("/partner/referrals/validate", run(async (req, res) => {
  const token = req.body?.referralToken; if (typeof token !== "string") throw new AuthError(400, "referralToken is required");
  const r = await pool.query(`SELECT t.id,t.expires_at,p.status,p.id AS partner_id FROM partner_referral_tokens t JOIN partner_profiles p ON p.id=t.partner_profile_id
    WHERE t.token_hash=$1 AND t.token_type='REFERRAL'`, [hash(token)]);
  const row = r.rows[0]; const valid = !!row && row.status === "ACTIVE" && row.expires_at > new Date() && row.status === "ACTIVE";
  res.json({ valid, status: valid ? "VALID" : row?.status !== "ACTIVE" ? "REVOKED" : "EXPIRED", partnerCode: valid ? `PARTNER-${String(row.partner_id).padStart(6,"0")}` : null, referralLinkId: valid ? row.id : null });
}));
router.post("/partner/onboarding", run(async (req, res) => {
  const token = req.body?.referralToken; const s = req.body?.school;
  if (typeof token !== "string" || !s?.name || !s?.code || !s?.city || !s?.state) throw new AuthError(400, "A referral token and complete school are required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(`SELECT t.id,t.partner_profile_id FROM partner_referral_tokens t JOIN partner_profiles p ON p.id=t.partner_profile_id
      WHERE t.token_hash=$1 AND t.token_type='REFERRAL' AND t.status='ACTIVE' AND (t.expires_at IS NULL OR t.expires_at>NOW()) AND p.status='ACTIVE' FOR UPDATE`, [hash(token)]);
    if (!t.rows[0]) throw new AuthError(400, "Referral token is expired, revoked, or already redeemed");
    const school = await client.query(`INSERT INTO schools(code,name,city,state,registration_number,address,lga,phone,email,website,logo,school_type,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,'active')) RETURNING id,code,name`, [s.code,s.name,s.city,s.state,s.registrationNumber??null,s.address??null,s.lga??null,s.phone??null,s.email??null,s.website??null,s.logoUrl??null,s.schoolType??null,s.status??null]);
    await client.query(`INSERT INTO school_partner_attributions(school_id,partner_profile_id,referral_token_id,status,is_current) VALUES($1,$2,$3,'ACTIVE',true)`, [school.rows[0].id,t.rows[0].partner_profile_id,t.rows[0].id]);
    await client.query(`UPDATE partner_referral_tokens SET status='REDEEMED',redeemed_at=NOW() WHERE id=$1`, [t.rows[0].id]);
    await client.query("COMMIT");
    res.status(201).json({ school: school.rows[0], attribution: { partnerId: t.rows[0].partner_profile_id, source: "REFERRAL" } });
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}));

router.get("/partner/profile", run(async (req,res) => res.json(await profile(req))));
router.get("/partner/dashboard", run(async (req,res) => {
  const p = await profile(req); const [schools, earned, paid] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int count FROM school_partner_attributions WHERE partner_profile_id=$1 AND is_current`,[p.id]),
    pool.query(`SELECT COALESCE(SUM(amount),0)::float amount FROM commission_ledger WHERE partner_profile_id=$1 AND status NOT IN ('REVERSED','CANCELLED')`,[p.id]),
    pool.query(`SELECT COALESCE(SUM(amount),0)::float amount FROM commission_ledger WHERE partner_profile_id=$1 AND status='PAID'`,[p.id])]);
  res.json({ referredSchools: schools.rows[0].count, eligibleStudents: 0, currentTermCommission: earned.rows[0].amount, lifetimeCommission: earned.rows[0].amount, paidCommission: paid.rows[0].amount, outstandingCommission: earned.rows[0].amount-paid.rows[0].amount });
}));
router.get("/partner/referral-link", run(async (req,res) => {
  const p = await profile(req); const token=crypto.randomBytes(32).toString("base64url");
  const r=await pool.query(`INSERT INTO partner_referral_tokens(partner_profile_id,token_hash) VALUES($1,$2) RETURNING id,created_at`,[p.id,hash(token)]);
  // The secret is carried only by the delivery URL; it is never persisted or
  // returned as a standalone API property.
  res.json({ id:r.rows[0].id, url:`/partner/onboarding?referralToken=${token}`, status:"ACTIVE", createdAt:r.rows[0].created_at });
}));
router.get("/partner/commissions", run(async(req,res)=>{const p=await profile(req); const r=await pool.query(`SELECT id,partner_profile_id AS "partnerId",subscription_id AS "subscriptionId",commission_rule_id AS "commissionRuleId",amount::float,term,status,created_at AS "generatedAt" FROM commission_ledger WHERE partner_profile_id=$1 ORDER BY created_at DESC`,[p.id]);res.json(r.rows)}));
router.get("/partner/payouts", run(async(req,res)=>{const p=await profile(req); const r=await pool.query(`SELECT id,partner_profile_id AS "partnerId",amount::float,status,created_at AS "createdAt",paid_at AS "paidAt" FROM partner_payouts WHERE partner_profile_id=$1 ORDER BY created_at DESC`,[p.id]);res.json(r.rows)}));
router.get("/partner/payout-information", run(async(req,res)=>{
  const p=await profile(req); const r=await pool.query(`SELECT id,method,account_name_encrypted AS "accountNameEncrypted",account_number_encrypted AS "accountNumberEncrypted",updated_at AS "updatedAt" FROM partner_payout_information WHERE partner_profile_id=$1 AND status='ACTIVE'`,[p.id]);
  if (!r.rows[0]) return res.json({ id: 0, payoutMethod: "BANK_TRANSFER", bankName: null, accountName: null, maskedAccountNumber: null, updatedAt: new Date() });
  res.json({ id:r.rows[0].id, payoutMethod:r.rows[0].method, bankName:null, accountName:"Stored securely", maskedAccountNumber:"****", updatedAt:r.rows[0].updatedAt });
}));
router.patch("/partner/payout-information", run(async(req,res)=>{
  const p=await profile(req); const b=req.body ?? {}; if (!b.accountName) throw new AuthError(400,"accountName is required");
  const r=await pool.query(`INSERT INTO partner_payout_information(partner_profile_id,method,account_name_encrypted,account_number_encrypted,bank_code_encrypted,encryption_key_version)
    VALUES($1,$2,$3,$4,$5,'v1') ON CONFLICT(partner_profile_id) DO UPDATE SET method=EXCLUDED.method,account_name_encrypted=EXCLUDED.account_name_encrypted,account_number_encrypted=COALESCE(NULLIF(EXCLUDED.account_number_encrypted,''),partner_payout_information.account_number_encrypted),bank_code_encrypted=EXCLUDED.bank_code_encrypted,updated_at=NOW()
    RETURNING id,method,updated_at AS "updatedAt"`,[p.id,b.payoutMethod??"BANK_TRANSFER",encrypt(b.accountName),b.accountNumber?encrypt(b.accountNumber):"",b.bankCode?encrypt(b.bankCode):null]);
  res.json({id:r.rows[0].id,payoutMethod:r.rows[0].method,bankName:b.bankName??null,accountName:b.accountName,maskedAccountNumber:mask(b.accountNumber??null),updatedAt:r.rows[0].updatedAt});
}));

router.use((err: unknown, req: Request, res: any, next: NextFunction) => { if (err instanceof AuthError) return res.status(err.statusCode).json({error:err.message,code:err.eventType}); next(err); });
export default router;