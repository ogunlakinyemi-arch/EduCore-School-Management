import { createHash } from "node:crypto";

export const ACCESS_ARCHIVE_EVENT = "TEST_ACCOUNT_ACCESS_ARCHIVE_V1";
export class ArchiveAccessError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const check = (yes, code) => { if (!yes) throw new ArchiveAccessError(code); };
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canonicalIds = value => {
  check(Array.isArray(value) && value.every(id => Number.isSafeInteger(id) && id > 0), "INVALID_ARCHIVE_SCOPE");
  return [...new Set(value)].sort((a, b) => a - b);
};
const email = value => typeof value === "string" ? value.trim().toLowerCase() : "";

// Append-only control records live in the EXISTING audit ledger. No auth/schema
// migration, user status edit, membership deletion or external identity mutation.
export async function activeAccessArchives(db) {
  const result = await db.query(`/* test-account-access-archive-ledger */
    SELECT metadata
    FROM audit_logs WHERE event_type=$1 AND module='Security' AND role='PLATFORM_OWNER'
    ORDER BY id LIMIT 10001`, [ACCESS_ARCHIVE_EVENT]);
  check(result.rows.length <= 10000, "ARCHIVE_LEDGER_REVIEW_REQUIRED");
  const batches = new Map();
  for (const row of result.rows) {
    const m = row.metadata;
    check(m?.version === 1 && typeof m.batchId === "string" && /^[a-f0-9]{64}$/.test(m.batchId)
      && ["BLOCK", "RESTORE"].includes(m.operation) && Array.isArray(m.emails)
      && m.emails.every(e => typeof e === "string" && e === email(e)), "INVALID_ARCHIVE_LEDGER");
    for (const key of ["schoolIds","partnerIds","userIds"]) {
      check(JSON.stringify(canonicalIds(m[key])) === JSON.stringify(m[key]), "INVALID_ARCHIVE_LEDGER");
    }
    check(m.schoolIds.length + m.partnerIds.length > 0
      && JSON.stringify([...new Set(m.emails)].sort()) === JSON.stringify(m.emails), "INVALID_ARCHIVE_LEDGER");
    const previous = batches.get(m.batchId);
    check(previous ? previous.operation === "BLOCK" && m.operation === "RESTORE"
      && ["schoolIds","partnerIds","userIds","emails"].every(key => JSON.stringify(previous[key]) === JSON.stringify(m[key]))
      : m.operation === "BLOCK", "INVALID_ARCHIVE_LEDGER_CHAIN");
    batches.set(m.batchId, m);
  }
  return [...batches.values()].filter(m => m.operation === "BLOCK");
}

export async function assertArchiveAccess(db, input) {
  const archives = await activeAccessArchives(db);
  if (!archives.length) return;
  const schoolIds = [...new Set(archives.flatMap(m => m.schoolIds))];
  const partnerIds = [...new Set(archives.flatMap(m => m.partnerIds))];
  if (input.schoolId && schoolIds.includes(input.schoolId)
      || input.partnerId && partnerIds.includes(input.partnerId)) {
    throw new ArchiveAccessError("ARCHIVED_TEST_ACCESS_BLOCKED");
  }
  if (input.userId) {
    const owner = await db.query(`SELECT 1 FROM school_memberships
      WHERE user_id=$1 AND role='PLATFORM_OWNER' AND school_id IS NULL AND status='ACTIVE' LIMIT 1`,
    [input.userId]);
    if (owner.rows.length) return;
  }
  const normalized = email(input.email);
  if (archives.some(m => input.userId && m.userIds.includes(input.userId)
      || normalized && m.emails.includes(normalized))) throw new ArchiveAccessError("ARCHIVED_TEST_ACCESS_BLOCKED");
  if (!input.userId && !normalized) return;
  // Re-evaluate associations as well as the captured IDs: later membership or
  // roster edits cannot re-enable an archived scope for a different identity.
  const associated = await db.query(`SELECT 1 WHERE
    EXISTS(SELECT 1 FROM school_memberships WHERE user_id=$1 AND school_id=ANY($3::int[]))
    OR EXISTS(SELECT 1 FROM students WHERE user_id=$1 AND school_id=ANY($3::int[]))
    OR EXISTS(SELECT 1 FROM parents WHERE user_id=$1 AND school_id=ANY($3::int[]))
    OR EXISTS(SELECT 1 FROM employees WHERE user_id=$1 AND school_id=ANY($3::int[]))
    OR EXISTS(SELECT 1 FROM parents p JOIN parent_student_relationships r ON r.parent_id=p.id
      JOIN students s ON s.id=r.student_id WHERE p.user_id=$1 AND s.school_id=ANY($3::int[]))
    OR EXISTS(SELECT 1 FROM partner_profiles WHERE id=ANY($4::int[])
      AND (user_id=$1 OR lower(trim(email))=$2))
    OR EXISTS(SELECT 1 FROM partner_profile_users WHERE partner_profile_id=ANY($4::int[]) AND user_id=$1)
    OR EXISTS(SELECT 1 FROM partner_invitations WHERE partner_profile_id=ANY($4::int[])
      AND lower(trim(invited_email))=$2)`, [input.userId ?? null, normalized, schoolIds, partnerIds]);
  if (associated.rows.length) throw new ArchiveAccessError("ARCHIVED_TEST_ACCESS_BLOCKED");
}

export async function prepareAccessArchive(db, input) {
  const schoolIds = canonicalIds(input.schoolIds), partnerIds = canonicalIds(input.partnerIds);
  check(schoolIds.length + partnerIds.length > 0, "EXPLICIT_TEST_ARCHIVE_SCOPE_REQUIRED");
  const schools = await db.query("SELECT id FROM schools WHERE id=ANY($1::int[]) ORDER BY id", [schoolIds]);
  const partners = await db.query("SELECT id FROM partner_profiles WHERE id=ANY($1::int[]) ORDER BY id", [partnerIds]);
  check(schools.rows.length === schoolIds.length && partners.rows.length === partnerIds.length, "ARCHIVE_SCOPE_NOT_FOUND");
  const owners = await db.query(`SELECT DISTINCT u.id,lower(trim(u.email)) AS email
    FROM app_users u JOIN school_memberships m ON m.user_id=u.id
    WHERE m.role='PLATFORM_OWNER' AND m.school_id IS NULL`);
  check(owners.rows.length > 0, "PLATFORM_OWNER_REQUIRED");
  const ownerIds = new Set(owners.rows.map(r => r.id));
  const ownerEmails = new Set(owners.rows.map(r => r.email));
  // Read minimal association evidence, including inactive historical rows. No
  // status is treated as proof that an unrelated tenant is disposable.
  const associations = (await db.query(`WITH links AS (
    SELECT m.user_id,m.school_id,NULL::integer AS partner_id,u.email,m.role
      FROM school_memberships m JOIN app_users u ON u.id=m.user_id
      WHERE m.school_id IS NOT NULL OR m.role NOT IN ('PLATFORM_OWNER','PARTNER')
    UNION ALL SELECT user_id,school_id,NULL,to_jsonb(t)->>'email',NULL FROM students t
    UNION ALL SELECT user_id,school_id,NULL,to_jsonb(t)->>'email',NULL FROM parents t
    UNION ALL SELECT user_id,school_id,NULL,to_jsonb(t)->>'email',NULL FROM employees t
    UNION ALL SELECT p.user_id,s.school_id,NULL,p.email,NULL FROM parents p
      JOIN parent_student_relationships r ON r.parent_id=p.id JOIN students s ON s.id=r.student_id
    UNION ALL SELECT user_id,NULL,id,email,'PARTNER' FROM partner_profiles
    UNION ALL SELECT pu.user_id,NULL,pu.partner_profile_id,u.email,pu.role
      FROM partner_profile_users pu JOIN app_users u ON u.id=pu.user_id
    UNION ALL SELECT NULL,NULL,partner_profile_id,invited_email,'PARTNER_STAFF' FROM partner_invitations
    UNION ALL SELECT NULL,a.school_id,NULL,
      COALESCE(a.metadata->>'email',a.metadata->>'invitedEmail'),NULL
      FROM audit_logs a WHERE a.school_id IS NOT NULL
        AND (a.event_type LIKE '%INVITATION%' OR a.event_type IN ('SCHOOL_ADMIN_INVITED','USER_INVITED'))
  )
  SELECT COALESCE(l.user_id,u.id) AS user_id,l.school_id,l.partner_id,
    lower(trim(COALESCE(l.email,u.email))) AS email,lower(trim(u.email)) AS account_email,l.role
  FROM links l LEFT JOIN app_users u ON u.id=l.user_id
    OR (l.user_id IS NULL AND lower(trim(u.email))=lower(trim(l.email)))`)).rows;
  const inScope = r => schoolIds.includes(r.school_id) || partnerIds.includes(r.partner_id);
  const selected = associations.filter(inScope);
  const userIds = [...new Set(selected.map(r => r.user_id).filter(id => id && !ownerIds.has(id)))].sort((a, b) => a - b);
  const emails = [...new Set(selected.filter(r => !ownerIds.has(r.user_id))
    .flatMap(r => [email(r.email),email(r.account_email)]).filter(e => e && !ownerEmails.has(e)))].sort();
  const mixed = associations.filter(r => !inScope(r) && !ownerIds.has(r.user_id)
    && (userIds.includes(r.user_id) || emails.includes(email(r.email))));
  check(mixed.length === 0, "ARCHIVE_ACCOUNT_HAS_OUT_OF_SCOPE_ACCESS");
  const existing = await activeAccessArchives(db);
  check(!existing.some(m => m.schoolIds.some(id => schoolIds.includes(id))
    || m.partnerIds.some(id => partnerIds.includes(id)) || m.userIds.some(id => userIds.includes(id))
    || m.emails.some(e => emails.includes(e))), "ARCHIVE_SCOPE_ALREADY_BLOCKED");
  const body = { version: 1, schoolIds, partnerIds, userIds, emails };
  return {
    ...body, planDigest: digest(body), userCount: userIds.length,
    emailCount: emails.length, protectedOwners: [...ownerIds].sort((a, b) => a - b),
    mutations: "APPEND_ONE_AUDIT_CONTROL_EVENT_ONLY",
  };
}

// Caller supplies a pinned PostgreSQL transaction. This function owns its
// locks/rechecks and never calls COMMIT. Public web routes cannot invoke it.
export async function applyAccessArchive(db, { plan, actorUserId, batchId, restore = false }) {
  check(typeof batchId === "string" && /^[a-f0-9]{64}$/.test(batchId), "INVALID_ARCHIVE_BATCH");
  await db.query("SELECT pg_advisory_xact_lock(192837465,20261025)");
  // Account/association edits cannot race the capture. NOWAIT fails rather than
  // disrupting another transaction. No constraint or trigger is disabled.
  await db.query(`LOCK TABLE audit_logs,app_users,school_memberships,schools,
    partner_profiles,partner_profile_users,partner_invitations,students,parents,employees,parent_student_relationships
    IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
  const actor = await db.query(`SELECT 1 FROM app_users u JOIN school_memberships m ON m.user_id=u.id
    WHERE u.id=$1 AND u.status='ACTIVE' AND m.role='PLATFORM_OWNER'
      AND m.school_id IS NULL AND m.status='ACTIVE'`, [actorUserId]);
  check(actor.rows.length > 0, "ACTIVE_PLATFORM_OWNER_REQUIRED");
  const effects = await db.query(`SELECT 1 FROM pg_trigger
    WHERE tgrelid='audit_logs'::regclass AND NOT tgisinternal AND tgenabled<>'D'
    UNION ALL SELECT 1 FROM pg_rewrite
    WHERE ev_class='audit_logs'::regclass AND rulename<>'_RETURN' LIMIT 1`);
  check(!effects.rows.length, "UNREVIEWED_AUDIT_WRITE_EFFECTS");
  let payload;
  if (restore) {
    payload = (await activeAccessArchives(db)).find(m => m.batchId === batchId);
    check(payload, "ACTIVE_ARCHIVE_BATCH_REQUIRED");
  } else {
    const used = await db.query(`SELECT 1 FROM audit_logs WHERE event_type=$1
      AND module='Security' AND metadata->>'batchId'=$2 LIMIT 1`, [ACCESS_ARCHIVE_EVENT, batchId]);
    check(!used.rows.length, "ARCHIVE_BATCH_ALREADY_USED");
    const current = await prepareAccessArchive(db, plan);
    check(current.planDigest === plan.planDigest, "ARCHIVE_ASSOCIATIONS_CHANGED_SINCE_REVIEW");
    payload = { version: 1, batchId, schoolIds: current.schoolIds, partnerIds: current.partnerIds,
      userIds: current.userIds, emails: current.emails };
  }
  const metadata = { ...payload, operation: restore ? "RESTORE" : "BLOCK" };
  await db.query(`INSERT INTO audit_logs
    ("user",role,actor_user_id,school_id,action,module,severity,event_type,result,metadata)
    SELECT 'Platform Owner','PLATFORM_OWNER',u.id,NULL,$2,'Security','critical',$3,'SUCCESS',$4::jsonb
    FROM app_users u WHERE u.id=$1`, [actorUserId,
    restore ? "Restored archived test account access" : "Revoked archived test account access",
    ACCESS_ARCHIVE_EVENT, JSON.stringify(metadata)]);
  return { batchId, operation: metadata.operation, affectedUsers: metadata.userIds.length,
    affectedEmails: metadata.emails.length, protectedRecordsChanged: 0 };
}
