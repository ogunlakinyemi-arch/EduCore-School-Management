import { Router, type IRouter, type Request } from "express";
import { pool } from "@workspace/db";
import {
  AuthError,
  ROLES,
  assertRoles,
  assertSchoolAccess,
  getUserContext,
  handleAuthError,
  requireAuthentication,
  type Role,
} from "../middlewares/auth";
import {
  activateAcceptedSchoolInvitation,
  createSchoolInvitation,
  INVITABLE_SCHOOL_ROLES,
} from "./school-invitations";

const router: IRouter = Router();
router.use(requireAuthentication());

const asyncRoute =
  (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any) =>
    handler(req, res).catch((error) => handleAuthError(error, req, res));

function userName(user: {
  firstName?: string | null;
  lastName?: string | null;
  email: string;
}) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

async function auditSecurityEvent(
  req: Request,
  schoolId: number | null,
  action: string,
  eventType: string,
  recordId: number | null,
  result = "SUCCESS",
) {
  const context = getUserContext(req);
  const role =
    context.roles.find((assignment) => assignment.schoolId === schoolId)?.role ??
    context.roles.find((assignment) => assignment.schoolId === null)?.role ??
    "AUTHENTICATED";
  await pool.query(
    `INSERT INTO audit_logs
      ("user", role, actor_user_id, clerk_user_id, school_id, action, module,
       record_id, severity, event_type, result)
     VALUES ($1, $2, $3, $4, $5, $6, 'Security', $7, $8, $9, $10)`,
    [
      userName(context.user),
      role,
      context.user.id,
      context.user.clerkUserId,
      schoolId,
      action,
      recordId,
      result === "SUCCESS" ? "info" : "critical",
      eventType,
      result,
    ],
  );
}

async function parentForUser(req: Request) {
  const context = getUserContext(req);
  const result = await pool.query(
    `SELECT id, school_id AS "schoolId", name, email, phone
     FROM parents WHERE user_id = $1`,
    [context.user.id],
  );
  if (!result.rows[0]) throw new AuthError(404, "Parent profile not found");
  return result.rows[0];
}

function parseRole(value: unknown): Role {
  if (typeof value !== "string" || !ROLES.includes(value as Role)) {
    throw new AuthError(400, "Unsupported role");
  }
  return value as Role;
}

router.get(
  "/me",
  asyncRoute(async (req, res) => {
    const context = getUserContext(req);
    res.json({
      id: context.user.id,
      clerkUserId: context.user.clerkUserId,
      email: context.user.email,
      firstName: context.user.firstName,
      lastName: context.user.lastName,
      phone: context.user.phone,
      status: context.user.status,
      name: userName(context.user),
      roles: context.roles,
    });
  }),
);

router.get(
  "/me/roles",
  asyncRoute(async (req, res) => {
    res.json(getUserContext(req).roles);
  }),
);

router.get(
  "/me/schools",
  asyncRoute(async (req, res) => {
    const context = getUserContext(req);
    const result = await pool.query(
      `SELECT sm.id, sm.school_id AS "schoolId", sm.role, sm.status,
              s.code, s.name, s.city, s.state
       FROM school_memberships sm
       JOIN schools s ON s.id = sm.school_id
       WHERE sm.user_id = $1 AND sm.status = 'ACTIVE'
       ORDER BY s.name`,
      [context.user.id],
    );
    res.json(result.rows);
  }),
);

router.get(
  "/me/authorized-context",
  asyncRoute(async (req, res) => {
    const initialContext = getUserContext(req);
    if (!initialContext.roles.length) {
      await activateAcceptedSchoolInvitation(
        initialContext.user.id,
        initialContext.user.clerkUserId,
      );
    }
    const roles = await pool.query(
      `SELECT id,role,school_id AS "schoolId",status
       FROM school_memberships WHERE user_id=$1 AND status='ACTIVE'`,
      [initialContext.user.id],
    );
    res.json({
      user: {
        id: initialContext.user.id,
        name: userName(initialContext.user),
        email: initialContext.user.email,
        status: initialContext.user.status,
      },
      isPlatformOwner: roles.rows.some(
        (assignment) =>
          assignment.role === "PLATFORM_OWNER" && assignment.schoolId === null,
      ),
      roles: roles.rows,
    });
  }),
);

router.get(
  "/parent/profile",
  asyncRoute(async (req, res) => {
    assertRoles(req, ["PARENT"]);
    const parent = await parentForUser(req);
    res.json(parent);
  }),
);

router.get(
  "/parent/children",
  asyncRoute(async (req, res) => {
    assertRoles(req, ["PARENT"]);
    const parent = await parentForUser(req);
    const result = await pool.query(
      `SELECT st.id, st.school_id AS "schoolId", st.admission_no AS "admissionNo",
          st.first_name AS "firstName", st.last_name AS "lastName", st.gender,
          st.class_name AS "className", st.section, st.status,
          s.code AS "schoolCode", s.name AS "schoolName",
          psr.relationship_type AS "relationshipType",
          psr.is_primary_guardian AS "isPrimaryGuardian",
          psr.is_emergency_contact AS "isEmergencyContact",
          psr.contact_priority AS "contactPriority"
       FROM parent_student_relationships psr
       JOIN students st ON st.id = psr.student_id
       JOIN schools s ON s.id = st.school_id
       WHERE psr.parent_id = $1 AND psr.status = 'ACTIVE'
       ORDER BY psr.contact_priority, st.last_name, st.first_name`,
      [parent.id],
    );
    res.json(result.rows);
  }),
);

router.get(
  "/parent/children/:studentId",
  asyncRoute(async (req, res) => {
    assertRoles(req, ["PARENT"]);
    const parent = await parentForUser(req);
    const studentId = Number(req.params.studentId);
    const result = await pool.query(
      `SELECT st.id, st.school_id AS "schoolId", st.admission_no AS "admissionNo",
          st.first_name AS "firstName", st.last_name AS "lastName", st.gender,
          st.class_name AS "className", st.section, st.status,
          s.code AS "schoolCode", s.name AS "schoolName", s.city, s.state
       FROM parent_student_relationships psr
       JOIN students st ON st.id = psr.student_id
       JOIN schools s ON s.id = st.school_id
       WHERE psr.parent_id = $1 AND psr.student_id = $2 AND psr.status = 'ACTIVE'`,
      [parent.id, studentId],
    );
    if (!result.rows[0]) throw new AuthError(404, "Student not found");
    res.json(result.rows[0]);
  }),
);

router.get(
  "/parent-student-relationships",
  asyncRoute(async (req, res) => {
    const context = getUserContext(req);
    let schoolId = req.query.schoolId ? Number(req.query.schoolId) : undefined;
    if (context.roles.some((assignment) => assignment.role === "PARENT")) {
      const parent = await parentForUser(req);
      const result = await pool.query(
        `SELECT psr.id, psr.parent_id AS "parentId", psr.student_id AS "studentId",
            psr.relationship_type AS "relationshipType",
            psr.is_primary_guardian AS "isPrimaryGuardian",
            psr.is_emergency_contact AS "isEmergencyContact",
            psr.contact_priority AS "contactPriority", psr.status,
            st.first_name || ' ' || st.last_name AS "studentName",
            p.name AS "parentName"
         FROM parent_student_relationships psr
         JOIN students st ON st.id = psr.student_id
         JOIN parents p ON p.id = psr.parent_id
         WHERE psr.parent_id = $1 ORDER BY psr.created_at DESC`,
        [parent.id],
      );
      return res.json(result.rows);
    }

    if (!schoolId) throw new AuthError(403, "A school context is required");
    assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    const result = await pool.query(
      `SELECT psr.id, psr.parent_id AS "parentId", psr.student_id AS "studentId",
          psr.relationship_type AS "relationshipType",
          psr.is_primary_guardian AS "isPrimaryGuardian",
          psr.is_emergency_contact AS "isEmergencyContact",
          psr.contact_priority AS "contactPriority", psr.status,
          st.first_name || ' ' || st.last_name AS "studentName",
          p.name AS "parentName"
       FROM parent_student_relationships psr
       JOIN students st ON st.id = psr.student_id
       JOIN parents p ON p.id = psr.parent_id
       WHERE st.school_id = $1 ORDER BY psr.created_at DESC`,
      [schoolId],
    );
    res.json(result.rows);
  }),
);

router.post(
  "/parent-student-relationships",
  asyncRoute(async (req, res) => {
    const { parentId, studentId, relationshipType, isPrimaryGuardian, isEmergencyContact, contactPriority } =
      req.body ?? {};
    const student = await pool.query(
      `SELECT id, school_id AS "schoolId" FROM students WHERE id = $1`,
      [Number(studentId)],
    );
    const parent = await pool.query(
      `SELECT id, school_id AS "schoolId" FROM parents WHERE id = $1`,
      [Number(parentId)],
    );
    if (!student.rows[0] || !parent.rows[0] || student.rows[0].schoolId !== parent.rows[0].schoolId) {
      throw new AuthError(404, "Parent or student not found");
    }
    assertSchoolAccess(req, student.rows[0].schoolId, ["SCHOOL_ADMIN"]);
    const result = await pool.query(
      `INSERT INTO parent_student_relationships
        (parent_id, student_id, relationship_type, is_primary_guardian,
         is_emergency_contact, contact_priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, parent_id AS "parentId", student_id AS "studentId",
         relationship_type AS "relationshipType",
         is_primary_guardian AS "isPrimaryGuardian",
         is_emergency_contact AS "isEmergencyContact",
         contact_priority AS "contactPriority", status`,
      [
        Number(parentId),
        Number(studentId),
        relationshipType || "Guardian",
        Boolean(isPrimaryGuardian),
        Boolean(isEmergencyContact),
        Number(contactPriority) || 1,
      ],
    );
    await auditSecurityEvent(
      req,
      student.rows[0].schoolId,
      "Linked parent to student",
      "PARENT_LINKED",
      result.rows[0].id,
    );
    res.status(201).json(result.rows[0]);
  }),
);

router.patch(
  "/parent-student-relationships/:relationshipId",
  asyncRoute(async (req, res) => {
    const relationshipId = Number(req.params.relationshipId);
    const existing = await pool.query(
      `SELECT psr.id, st.school_id AS "schoolId"
       FROM parent_student_relationships psr
       JOIN students st ON st.id = psr.student_id
       WHERE psr.id = $1`,
      [relationshipId],
    );
    if (!existing.rows[0]) throw new AuthError(404, "Relationship not found");
    assertSchoolAccess(req, existing.rows[0].schoolId, ["SCHOOL_ADMIN"]);
    const result = await pool.query(
      `UPDATE parent_student_relationships
       SET relationship_type = COALESCE($1, relationship_type),
           is_primary_guardian = COALESCE($2, is_primary_guardian),
           is_emergency_contact = COALESCE($3, is_emergency_contact),
           contact_priority = COALESCE($4, contact_priority),
           status = COALESCE($5, status),
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, parent_id AS "parentId", student_id AS "studentId",
         relationship_type AS "relationshipType",
         is_primary_guardian AS "isPrimaryGuardian",
         is_emergency_contact AS "isEmergencyContact",
         contact_priority AS "contactPriority", status`,
      [
        req.body?.relationshipType ?? null,
        req.body?.isPrimaryGuardian === undefined ? null : Boolean(req.body.isPrimaryGuardian),
        req.body?.isEmergencyContact === undefined ? null : Boolean(req.body.isEmergencyContact),
        req.body?.contactPriority === undefined ? null : Number(req.body.contactPriority),
        req.body?.status ?? null,
        relationshipId,
      ],
    );
    await auditSecurityEvent(
      req,
      existing.rows[0].schoolId,
      "Updated parent-student relationship",
      "PARENT_RELATIONSHIP_UPDATED",
      relationshipId,
    );
    res.json(result.rows[0]);
  }),
);

router.delete(
  "/parent-student-relationships/:relationshipId",
  asyncRoute(async (req, res) => {
    const relationshipId = Number(req.params.relationshipId);
    const existing = await pool.query(
      `SELECT psr.id, st.school_id AS "schoolId"
       FROM parent_student_relationships psr
       JOIN students st ON st.id = psr.student_id
       WHERE psr.id = $1`,
      [relationshipId],
    );
    if (!existing.rows[0]) throw new AuthError(404, "Relationship not found");
    assertSchoolAccess(req, existing.rows[0].schoolId, ["SCHOOL_ADMIN"]);
    await pool.query(
      `UPDATE parent_student_relationships
       SET status = 'INACTIVE', updated_at = NOW() WHERE id = $1`,
      [relationshipId],
    );
    await auditSecurityEvent(
      req,
      existing.rows[0].schoolId,
      "Deactivated parent-student relationship",
      "PARENT_UNLINKED",
      relationshipId,
    );
    res.status(204).send();
  }),
);

router.get(
  "/users",
  asyncRoute(async (req, res) => {
    assertRoles(req, ["PLATFORM_OWNER"]);
    const result = await pool.query(
      `SELECT au.id, au.clerk_user_id AS "clerkUserId", au.email,
          au.first_name AS "firstName", au.last_name AS "lastName",
          au.phone, au.status, au.created_at AS "createdAt",
          COALESCE(json_agg(json_build_object(
            'id', sm.id, 'schoolId', sm.school_id, 'role', sm.role, 'status', sm.status
          )) FILTER (WHERE sm.id IS NOT NULL), '[]') AS memberships
       FROM app_users au
       LEFT JOIN school_memberships sm ON sm.user_id = au.id
       GROUP BY au.id ORDER BY au.created_at DESC`,
    );
    res.json(result.rows);
  }),
);

router.post(
  "/platform-users",
  asyncRoute(async (req, res) => {
    assertRoles(req, ["PLATFORM_OWNER"]);
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const role = parseRole(req.body?.role);
    const context = getUserContext(req);
    if (role !== "PLATFORM_OWNER") {
      throw new AuthError(400, "Only platform roles may be assigned here");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AuthError(400, "A valid user email is required");
    }
    const matchingUsers = await pool.query(
      `SELECT id FROM app_users WHERE lower(email)=lower($1) ORDER BY id LIMIT 2`,
      [email],
    );
    if (matchingUsers.rows.length > 1) {
      throw new AuthError(409, "Multiple accounts use this email; resolve the duplicate before assigning a platform role");
    }
    if (!matchingUsers.rows[0]) throw new AuthError(404, "User account not found");
    const userId = matchingUsers.rows[0].id;
    if (userId === context.user.id) {
      throw new AuthError(403, "You cannot change your own platform role");
    }
    const result = await pool.query(
      `INSERT INTO school_memberships (user_id, school_id, role)
       VALUES ($1, NULL, 'PLATFORM_OWNER')
       ON CONFLICT (user_id, role) WHERE school_id IS NULL
       DO UPDATE SET status = 'ACTIVE', updated_at = NOW()
       RETURNING id, user_id AS "userId", school_id AS "schoolId", role, status`,
      [userId],
    );
    await auditSecurityEvent(
      req,
      null,
      "Assigned platform owner role",
      "USER_ROLE_CHANGED",
      result.rows[0].id,
    );
    res.status(201).json(result.rows[0]);
  }),
);

router.patch(
  "/platform-memberships/:membershipId/status",
  asyncRoute(async (req, res) => {
    assertRoles(req, ["PLATFORM_OWNER"]);
    const membershipId = Number(req.params.membershipId);
    const status = req.body?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    const context = getUserContext(req);
    const existing = await pool.query(
      `SELECT id, user_id AS "userId" FROM school_memberships
       WHERE id = $1 AND school_id IS NULL AND role = 'PLATFORM_OWNER'`,
      [membershipId],
    );
    if (!existing.rows[0]) throw new AuthError(404, "Platform membership not found");
    if (existing.rows[0].userId === context.user.id) {
      throw new AuthError(403, "You cannot change your own platform role");
    }
    const result = await pool.query(
      `UPDATE school_memberships SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, user_id AS "userId", school_id AS "schoolId", role, status`,
      [status, membershipId],
    );
    await auditSecurityEvent(
      req,
      null,
      `${status === "ACTIVE" ? "Activated" : "Deactivated"} platform owner role`,
      "USER_ROLE_CHANGED",
      membershipId,
    );
    res.json(result.rows[0]);
  }),
);

router.get(
  "/school-users",
  asyncRoute(async (req, res) => {
    const schoolId = Number(req.query.schoolId);
    if (!Number.isInteger(schoolId) || schoolId < 1) {
      throw new AuthError(403, "A school context is required");
    }
    assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    const result = await pool.query(
      `SELECT au.id, au.email, au.first_name AS "firstName", au.last_name AS "lastName",
          au.phone, au.status AS "userStatus", sm.id AS "membershipId",
          sm.role, sm.status AS "membershipStatus", sm.school_id AS "schoolId"
       FROM school_memberships sm
       JOIN app_users au ON au.id = sm.user_id
       WHERE sm.school_id = $1 ORDER BY au.last_name, au.first_name, au.email`,
      [schoolId],
    );
    res.json(result.rows);
  }),
);

router.post(
  "/schools/:schoolId/administrators",
  asyncRoute(async (req, res) => {
    assertRoles(req, ["PLATFORM_OWNER"]);
    const schoolId = Number(req.params.schoolId);
    const fullName = String(req.body?.fullName ?? "").trim().replace(/\s+/g, " ");
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const phone = String(req.body?.phone ?? "").trim();
    if (Object.hasOwn(req.body ?? {}, "password") || Object.hasOwn(req.body ?? {}, "confirmPassword")) {
      throw new AuthError(400, "Passwords are created by the invitee and must not be submitted by an administrator");
    }
    if (!Number.isInteger(schoolId) || schoolId < 1) throw new AuthError(404, "School not found");
    if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AuthError(400, "A valid name and email are required");
    }
    if (phone && !/^\+?[0-9][0-9\s()-]{7,24}$/.test(phone)) {
      throw new AuthError(400, "A valid phone is required");
    }
    const created = await createSchoolInvitation(
      { schoolId, fullName, email, phone: phone || null, role: "SCHOOL_ADMIN" },
      getUserContext(req),
    );
    res.status(created.status === "INVITATION_SENT" ? 202 : 201).json(created);
  }),
);

router.post(
  "/school-users/invitations",
  asyncRoute(async (req, res) => {
    const schoolId = Number(req.body?.schoolId);
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const fullName = String(req.body?.fullName ?? "").trim().replace(/\s+/g, " ");
    const phone = String(req.body?.phone ?? "").trim();
    const role = parseRole(req.body?.role);
    if (Object.hasOwn(req.body ?? {}, "password") || Object.hasOwn(req.body ?? {}, "confirmPassword")) {
      throw new AuthError(400, "Passwords are created by the invitee and must not be submitted by an administrator");
    }
    if (!Number.isInteger(schoolId) || schoolId < 1) {
      throw new AuthError(400, "A valid school context is required");
    }
    assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    if (!(INVITABLE_SCHOOL_ROLES as readonly string[]).includes(role) || role === "SCHOOL_ADMIN") {
      throw new AuthError(403, "This role cannot be assigned through a school invitation");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || fullName.length < 2) {
      throw new AuthError(400, "A valid full name and email are required");
    }
    if (phone && !/^\+?[0-9][0-9\s()-]{7,24}$/.test(phone)) {
      throw new AuthError(400, "A valid phone is required");
    }
    const created = await createSchoolInvitation(
      { schoolId, fullName, email, phone: phone || null, role: role as
        "TEACHER" | "ACCOUNTANT" | "STAFF" | "PARENT" },
      getUserContext(req),
    );
    res.status(created.status === "INVITATION_SENT" ? 202 : 201).json(created);
  }),
);

router.post(
  "/school-users",
  asyncRoute(async (req, res) => {
    const schoolId = Number(req.body?.schoolId);
    const userId = Number(req.body?.userId);
    const role = parseRole(req.body?.role);
    if (!["TEACHER", "ACCOUNTANT", "STAFF", "PARENT", "STUDENT"].includes(role)) {
      throw new AuthError(403, "This role cannot be assigned by a School Administrator");
    }
    assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    const context = getUserContext(req);
    if (userId === context.user.id) {
      throw new AuthError(403, "You cannot change your own role");
    }
    const user = await pool.query(`SELECT id FROM app_users WHERE id = $1`, [userId]);
    if (!user.rows[0]) throw new AuthError(404, "User not found");
    const result = await pool.query(
      `INSERT INTO school_memberships (user_id, school_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, school_id, role) DO UPDATE SET status = 'ACTIVE', updated_at = NOW()
       RETURNING id, user_id AS "userId", school_id AS "schoolId", role, status`,
      [userId, schoolId, role],
    );
    if (role === "PARENT") {
      await pool.query(
        `UPDATE parents p
         SET user_id = $1
         FROM app_users au
         WHERE au.id = $1 AND p.school_id = $2 AND lower(p.email) = lower(au.email)
           AND p.user_id IS NULL`,
        [userId, schoolId],
      );
    }
    await auditSecurityEvent(
      req,
      schoolId,
      `Assigned ${role} school role`,
      "USER_ROLE_CHANGED",
      result.rows[0].id,
    );
    res.status(201).json(result.rows[0]);
  }),
);

router.patch(
  "/school-users/:userId/status",
  asyncRoute(async (req, res) => {
    const userId = Number(req.params.userId);
    const schoolId = Number(req.body?.schoolId);
    const status = req.body?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    if (userId === getUserContext(req).user.id) {
      throw new AuthError(403, "You cannot change your own membership status");
    }
    const result = await pool.query(
      `UPDATE school_memberships SET status = $1, updated_at = NOW()
       WHERE user_id = $2 AND school_id = $3
       RETURNING id, user_id AS "userId", school_id AS "schoolId", role, status`,
      [status, userId, schoolId],
    );
    if (!result.rows[0]) throw new AuthError(404, "School user not found");
    await auditSecurityEvent(
      req,
      schoolId,
      `${status === "ACTIVE" ? "Activated" : "Deactivated"} school membership`,
      status === "ACTIVE" ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      result.rows[0].id,
    );
    res.json(result.rows[0]);
  }),
);

router.patch(
  "/school-memberships/:membershipId/role",
  asyncRoute(async (req, res) => {
    const membershipId = Number(req.params.membershipId);
    const role = parseRole(req.body?.role);
    if (!["TEACHER", "ACCOUNTANT", "STAFF", "PARENT", "STUDENT"].includes(role)) {
      throw new AuthError(403, "This role cannot be assigned by a School Administrator");
    }
    const existing = await pool.query(
      `SELECT id, user_id AS "userId", school_id AS "schoolId", role
       FROM school_memberships WHERE id = $1`,
      [membershipId],
    );
    if (!existing.rows[0]) throw new AuthError(404, "Membership not found");
    assertSchoolAccess(req, existing.rows[0].schoolId, ["SCHOOL_ADMIN"]);
    if (existing.rows[0].userId === getUserContext(req).user.id) {
      throw new AuthError(403, "You cannot change your own role");
    }
    const result = await pool.query(
      `UPDATE school_memberships SET role = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, user_id AS "userId", school_id AS "schoolId", role, status`,
      [role, membershipId],
    );
    await auditSecurityEvent(
      req,
      existing.rows[0].schoolId,
      `Changed school role from ${existing.rows[0].role} to ${role}`,
      "USER_ROLE_CHANGED",
      membershipId,
    );
    res.json(result.rows[0]);
  }),
);

router.patch(
  "/users/:userId/status",
  asyncRoute(async (req, res) => {
    assertRoles(req, ["PLATFORM_OWNER"]);
    const userId = Number(req.params.userId);
    const status = req.body?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    const result = await pool.query(
      `UPDATE app_users SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, first_name AS "firstName", last_name AS "lastName", status`,
      [status, userId],
    );
    if (!result.rows[0]) throw new AuthError(404, "User not found");
    await auditSecurityEvent(
      req,
      null,
      `${status === "ACTIVE" ? "Activated" : "Deactivated"} Yemait EduCore user`,
      status === "ACTIVE" ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      userId,
    );
    res.json(result.rows[0]);
  }),
);

export default router;