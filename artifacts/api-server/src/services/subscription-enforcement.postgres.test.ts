import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { assertSubscriptionAccess, readSchoolSubscription, readSchoolEnforcementSummary, reconcileSchoolSubscription } from "./subscription-enforcement";
import { changeManualSchoolLock, readManualSchoolState } from "./school-subscription-lock";
import { enforceRequestSubscription } from "./subscription-request-access";
import type { Request } from "express";
import type { UserContext } from "../middlewares/auth";

const native = process.env.RUN_SUBSCRIPTION_ENFORCEMENT_POSTGRES === "1";
describe.skipIf(!native)("subscription enforcement in disposable PostgreSQL", () => {
  let a: number, b: number, termA: number, termB: number;
  let paid: number, unpaid: number, other: number, parentUser: number, parentA: number, parentB: number;
  let ownerUser: number;
  let preserved: Record<string, string[]>;
  const today = "(NOW() AT TIME ZONE 'Africa/Lagos')::date";
  const q = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows;
  beforeAll(async () => {
    const identity = (await q("SELECT current_setting('data_directory') dir,inet_server_addr() host"))[0];
    if (identity.dir !== "/tmp/educore-enforcement-pg" || identity.host !== null) throw Error("Disposable database only");
    const migration = await readFile("../../lib/db/drizzle/0049_term_subscription_enforcement.sql", "utf8");
    await pool.query(migration);
    await pool.query(migration);
    const manualMigration = await readFile("../../lib/db/drizzle/0050_independent_owner_school_lock.sql", "utf8");
    await pool.query(manualMigration);
    await pool.query(manualMigration);
    [a, b] = (await q(`INSERT INTO schools(code,name,state,city) VALUES('enforce-a','Enforcement A','Lagos','Lagos'),('enforce-b','Enforcement B','Lagos','Lagos') RETURNING id`)).map(r => Number(r.id));
    for (const id of [a, b]) {
      const session = (await q(`INSERT INTO academic_sessions(school_id,name,start_date,end_date,status,is_current)
        VALUES($1,'Enforcement Session',${today}-30,${today}+90,'ACTIVE',true) RETURNING id`, [id]))[0].id;
      const term = (await q(`INSERT INTO academic_terms(school_id,academic_session_id,name,start_date,end_date,status,is_current)
        VALUES($1,$2,'Enforcement Term',${today}-10,${today}+60,'ACTIVE',true) RETURNING id`, [id, session]))[0].id;
      if (id === a) termA = Number(term); else termB = Number(term);
    }
    [paid, unpaid, other] = (await q(`INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section)
      VALUES($1,'paid','Paid','Fixture','Male','One','A'),($1,'unpaid','Unpaid','Fixture','Male','One','A'),
        ($2,'other','Other','Fixture','Male','One','A') RETURNING id`, [a, b])).map(r => Number(r.id));
    parentUser = Number((await q(`INSERT INTO app_users(clerk_user_id,email,first_name,last_name)
      VALUES('native_subscription_parent','native-subscription-parent@example.com','Native','Parent') RETURNING id`))[0].id);
    parentA = Number((await q(`INSERT INTO parents(school_id,user_id,name,email,phone)
      VALUES($1,$2,'Native Parent','native-subscription-parent@example.com','08000000000') RETURNING id`, [a, parentUser]))[0].id);
    parentB = parentA;
    await q(`INSERT INTO parent_student_relationships(parent_id,student_id) VALUES($1,$3),($1,$4),($2,$5)`, [parentA, parentB, paid, unpaid, other]);
    await q(`INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'PARENT'),($1,$3,'PARENT')`, [parentUser, a, b]);
    await q(`INSERT INTO nfc_cards(school_id,student_id,uid,status)
      VALUES($1,$2,'native-paid','active'),($1,$3,'native-unpaid','active'),
        ($1,$3,'native-lost','lost'),($1,$3,'native-revoked','blocked'),($1,$3,'native-locked','locked')`, [a, paid, unpaid]);
    await q(`INSERT INTO platform_devices(serial_number,name,device_type,school_id,status) VALUES('native-enforcement-reader','Native reader','NFC',$1,'ACTIVE')`, [a]);
    ownerUser = Number((await q(`INSERT INTO app_users(clerk_user_id,email,first_name,last_name)
      VALUES('native_isolated_owner','native-isolated-owner@example.com','Isolated','Owner') RETURNING id`))[0].id);
    const teacherUser = Number((await q(`INSERT INTO app_users(clerk_user_id,email,first_name,last_name)
      VALUES('native_isolated_teacher','native-isolated-teacher@example.com','Isolated','Teacher') RETURNING id`))[0].id);
    await q("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'TEACHER')", [teacherUser, a]);
    const employee = (await q(`INSERT INTO employees(school_id,user_id,employee_no,first_name,last_name)
      VALUES($1,$2,'NATIVE-TEACHER','Isolated','Teacher') RETURNING id`, [a, teacherUser]))[0];
    const card = (await q("INSERT INTO nfc_cards(school_id,uid,status) VALUES($1,'native-teacher','active') RETURNING id", [a]))[0];
    await q(`INSERT INTO employee_nfc_card_bindings(school_id,nfc_card_id,employee_id,status,created_by_user_id)
      VALUES($1,$2,$3,'ACTIVE',$4)`, [a, card.id, employee.id, ownerUser]);
  });
  afterAll(async () => { await pool.end(); });
  const verify = async (studentId: number, schoolId: number) => {
    await q(`INSERT INTO subscriptions(school_id,student_id,term,status,verification_status,expires_at)
      SELECT $1,$2,t.name,'active','verified',(t.end_date+1)::timestamptz FROM academic_terms t WHERE t.school_id=$1 AND t.is_current=true`, [schoolId, studentId]);
  };
  const parentContext = (): UserContext => ({
    user: { id: parentUser, clerkUserId: "native_subscription_parent", email: "native-subscription-parent@example.com", firstName: "Native", lastName: "Parent", phone: null, status: "ACTIVE" },
    roles: [{ id: 1, role: "PARENT", schoolId: a, status: "ACTIVE" }, { id: 2, role: "PARENT", schoolId: b, status: "ACTIVE" }],
  });
  const request = (originalUrl: string, body = {}, method = "GET") => ({ originalUrl, method, body, query: {} }) as Request;
  const actor = () => ({ id: ownerUser, clerkUserId: "native_isolated_owner", email: "native-isolated-owner@example.com" });
  const manual = async (schoolId: number, locked: boolean) => changeManualSchoolLock(schoolId, locked, actor(),
    (await readManualSchoolState(pool, schoolId)).manualVersion, "Isolated verification", "isolated-request");
  const protectedHashes = async () => {
    const hashes: Record<string, string[]> = {};
    for (const table of ["students","parents","parent_student_relationships","subscriptions","academic_sessions","academic_terms","nfc_cards","platform_devices","employees","employee_nfc_card_bindings","academic_results","academic_assignments"]) {
      hashes[table] = (await q(`SELECT md5(row_to_json(r)::text) hash FROM ${table} r ORDER BY hash`)).map(r => r.hash);
    }
    return hashes;
  };
  it("migration replays safely and enforces tenant-bound term foreign keys", async () => {
    await expect(q("INSERT INTO school_subscription_enforcement(school_id,academic_term_id,snapshot) VALUES($1,$2,'{}')", [a, termB])).rejects.toMatchObject({ code: "23503" });
  });
  it("unverified checkouts do not cover students", async () => {
    await q(`INSERT INTO subscriptions(school_id,student_id,term,status,verification_status,expires_at)
      SELECT $1,$2,name,'active','pending',(end_date+1)::timestamptz FROM academic_terms WHERE id=$3`, [a, paid, termA]);
    expect(await readSchoolSubscription(pool, a)).toMatchObject({ schoolLocked: false, studentsPaid: 0, studentsAffected: 2, devicesLocked: 0 });
  });
  it("grace period leaves all students and readers available", async () => {
    await q(`UPDATE academic_terms SET start_date=${today}-6 WHERE id=$1`, [termA]);
    expect(await readSchoolSubscription(pool, a)).toMatchObject({ inGracePeriod: true, schoolLocked: false, studentsAffected: 0, devicesLocked: 0 });
    await expect(assertSubscriptionAccess(a, unpaid)).resolves.toBeUndefined();
    await q(`UPDATE academic_terms SET start_date=${today}-10 WHERE id=$1`, [termA]);
  });
  it("verified partial coverage protects paid siblings and readers", async () => {
    await verify(paid, a);
    expect(await readSchoolSubscription(pool, a)).toMatchObject({ status: "PARTIALLY_PAID", schoolLocked: false, restrictedStudentIds: [unpaid], devicesLocked: 0, teachersAffected: 0, cardsLocked: 1, amountPaidMinor: 500_000, outstandingMinor: 500_000 });
    await expect(assertSubscriptionAccess(a, paid)).resolves.toBeUndefined();
    await expect(assertSubscriptionAccess(a)).resolves.toBeUndefined();
    await expect(assertSubscriptionAccess(a, unpaid)).rejects.toMatchObject({ statusCode: 403, eventType: "SUBSCRIPTION_REQUIRED" });
  });
  it("repeated enforcement does not duplicate audit or notifications", async () => {
    const first = await reconcileSchoolSubscription(a, "AUTOMATIC_TERM_ENFORCEMENT");
    expect(first.changed).toBe(true);
    const audit = Number((await q("SELECT count(*) n FROM audit_logs WHERE school_id=$1", [a]))[0].n);
    const notices = Number((await q("SELECT count(*) n FROM communication_notifications WHERE school_id=$1", [a]))[0].n);
    expect(notices).toBeGreaterThan(0);
    expect((await reconcileSchoolSubscription(a, "AUTOMATIC_TERM_ENFORCEMENT")).changed).toBe(false);
    expect(Number((await q("SELECT count(*) n FROM audit_logs WHERE school_id=$1", [a]))[0].n)).toBe(audit);
    expect(Number((await q("SELECT count(*) n FROM communication_notifications WHERE school_id=$1", [a]))[0].n)).toBe(notices);
  });
  it("preserves every permanent card state and reader registration", async () => {
    expect((await q("SELECT status FROM nfc_cards WHERE school_id=$1 ORDER BY id", [a])).map(r => r.status)).toEqual(["active", "active", "lost", "blocked", "locked", "active"]);
    expect((await q("SELECT status FROM platform_devices WHERE school_id=$1", [a]))[0].status).toBe("ACTIVE");
  });
  it("a parent keeps the paid sibling in the same school", async () => {
    await expect(enforceRequestSubscription(request(`/api/parent/children/${paid}/attendance`), parentContext())).resolves.toBeUndefined();
    await expect(enforceRequestSubscription(request(`/api/parent/children/${unpaid}/attendance`), parentContext())).rejects.toMatchObject({ eventType: "SUBSCRIPTION_REQUIRED" });
  });
  it("a parent's children in different schools are isolated", async () => {
    await expect(enforceRequestSubscription(request(`/api/academic/parents/children/${paid}/results`), parentContext())).resolves.toBeUndefined();
    await expect(enforceRequestSubscription(request(`/api/academic/parents/children/${other}/results`), parentContext())).rejects.toMatchObject({ eventType: "SUBSCRIPTION_REQUIRED" });
  });
  it("blocks unpaid child timetables without blocking the paid sibling", async () => {
    await expect(enforceRequestSubscription(request(`/api/academic/parents/children/${unpaid}/timetable`), parentContext())).rejects.toMatchObject({ eventType: "SUBSCRIPTION_REQUIRED" });
    await expect(enforceRequestSubscription(request(`/api/academic/parents/children/${paid}/timetable`), parentContext())).resolves.toBeUndefined();
  });
  it("cannot bypass Student self-service restrictions with an ignored foreign studentId", async () => {
    await q("UPDATE students SET user_id=$1 WHERE id=$2", [parentUser, unpaid]);
    const student = { ...parentContext(), roles: [{ id: 4, role: "STUDENT" as const, schoolId: a, status: "ACTIVE" as const }] };
    const spoofed = request("/api/academic/me/assignments", { studentId: paid });
    spoofed.query = { studentId: String(paid) };
    await expect(enforceRequestSubscription(spoofed, student)).rejects.toMatchObject({ eventType: "SUBSCRIPTION_REQUIRED" });
    await q("UPDATE students SET user_id=NULL WHERE id=$1", [unpaid]);
  });
  it("keeps teachers active even when every student at their school is unpaid", async () => {
    const teacher = (schoolId: number): UserContext => ({ ...parentContext(), roles: [{ id: 3, role: "TEACHER", schoolId, status: "ACTIVE" }] });
    for (const endpoint of ["attendance", "lesson-notes", "curriculum"]) {
      await expect(enforceRequestSubscription(request(`/api/schools/${b}/${endpoint}`, {}, "POST"), teacher(b))).resolves.toBeUndefined();
      await expect(enforceRequestSubscription(request(`/api/schools/${a}/${endpoint}`, {}, "POST"), teacher(a))).resolves.toBeUndefined();
    }
    await expect(enforceRequestSubscription(request(`/api/schools/${b}/lesson-notes`), teacher(b))).resolves.toBeUndefined();
  });
  it("requires a live target-school Parent membership for a cross-school relation", async () => {
    await q("UPDATE school_memberships SET status='INACTIVE' WHERE user_id=$1 AND school_id=$2 AND role='PARENT'", [parentUser, b]);
    // The subscription supplement does not reveal eligibility; the endpoint's
    // existing authorization will reject this no-longer-authorized child.
    await expect(enforceRequestSubscription(request(`/api/parent/children/${other}/attendance`), parentContext())).resolves.toBeUndefined();
    await q("UPDATE school_memberships SET status='ACTIVE' WHERE user_id=$1 AND school_id=$2 AND role='PARENT'", [parentUser, b]);
  });
  it("does not disclose a foreign parent's child eligibility", async () => {
    const stranger = { ...parentContext(), user: { ...parentContext().user, id: parentUser + 999 } };
    await expect(enforceRequestSubscription(request(`/api/parent/children/${unpaid}/attendance`), stranger)).resolves.toBeUndefined();
  });
  it("blocks parent thread creation only for unpaid owned children", async () => {
    await expect(enforceRequestSubscription(request("/api/communication/parent/threads", { studentId: unpaid }, "POST"), parentContext())).rejects.toMatchObject({ eventType: "SUBSCRIPTION_REQUIRED" });
    await expect(enforceRequestSubscription(request("/api/communication/parent/threads", { studentId: paid }, "POST"), parentContext())).resolves.toBeUndefined();
  });
  it("preserves login, account, preferences, inbox and payment-resolution routes", async () => {
    for (const url of ["/api/me/authorized-context", "/api/communication/notifications", "/api/notification-settings", "/api/subscriptions", "/api/me/fees"]) {
      await expect(enforceRequestSubscription(request(url), parentContext())).resolves.toBeUndefined();
    }
  });
  it("verified payment restores only the independent restriction", async () => {
    await q("UPDATE app_users SET status='INACTIVE' WHERE id=$1", [parentUser]);
    await verify(unpaid, a);
    await expect(assertSubscriptionAccess(a, unpaid)).resolves.toBeUndefined();
    expect((await reconcileSchoolSubscription(a, "SUBSCRIPTION_PAYMENT_RESTORATION")).changed).toBe(true);
    expect((await q("SELECT restricted_student_ids,school_locked FROM school_subscription_enforcement WHERE school_id=$1 AND academic_term_id=$2", [a, termA]))[0]).toMatchObject({ restricted_student_ids: [], school_locked: false });
    expect((await q("SELECT status FROM nfc_cards WHERE school_id=$1 ORDER BY id", [a])).map(r => r.status)).toEqual(["active", "active", "lost", "blocked", "locked", "active"]);
    expect((await reconcileSchoolSubscription(a, "SUBSCRIPTION_PAYMENT_RESTORATION")).changed).toBe(false);
    expect((await q("SELECT status FROM app_users WHERE id=$1", [parentUser]))[0].status).toBe("INACTIVE");
    await q("UPDATE app_users SET status='ACTIVE' WHERE id=$1", [parentUser]);
    expect((await readSchoolSubscription(pool, b))?.restrictedStudentIds).toEqual([other]);
  });
  it("missing or ambiguous calendars never manufacture unpaid locks", async () => {
    await q("UPDATE academic_terms SET is_current=false WHERE id=$1", [termB]);
    expect(await readSchoolSubscription(pool, b)).toBeNull();
    expect((await reconcileSchoolSubscription(b, "AUTOMATIC_TERM_ENFORCEMENT")).state).toBe("UNAVAILABLE");
    await expect(assertSubscriptionAccess(b, other)).resolves.toBeUndefined();
    await q("UPDATE academic_terms SET is_current=true WHERE id=$1", [termB]);
  });
  it("rejects stale Owner term selections without changing restrictions", async () => {
    await expect(reconcileSchoolSubscription(b, "AUTOMATIC_TERM_ENFORCEMENT", undefined, termA)).rejects.toMatchObject({ statusCode: 409 });
    expect((await q("SELECT count(*) n FROM school_subscription_enforcement WHERE school_id=$1", [b]))[0].n).toBe("0");
  });
  it("queues an owned cross-school parent's restriction through the existing notification engine", async () => {
    expect((await reconcileSchoolSubscription(b, "AUTOMATIC_TERM_ENFORCEMENT")).changed).toBe(true);
    expect((await q("SELECT count(*) n FROM communication_notifications WHERE school_id=$1 AND recipient_user_id=$2 AND subject_student_id=$3", [b, parentUser, other]))[0].n).toBe("1");
  });
  it("records per-student automatic enforcement and payment restoration audits", async () => {
    const logs = await q("SELECT metadata FROM audit_logs WHERE event_type='STUDENT_SUBSCRIPTION_ACCESS_CHANGED' AND school_id=$1 ORDER BY id", [a]);
    expect(logs.some(r => r.metadata.studentId === unpaid && r.metadata.newState === "SUBSCRIPTION_RESTRICTED")).toBe(true);
    expect(logs.some(r => r.metadata.studentId === unpaid && r.metadata.source === "SUBSCRIPTION_PAYMENT_RESTORATION" && r.metadata.newState === "ACTIVE")).toBe(true);
    expect(logs.every(r => r.metadata.termId === termA && r.metadata.sessionId)).toBe(true);
  });
  it("lets Owner lock a paid school without changing its billing state", async () => {
    preserved = await protectedHashes();
    expect(await manual(a, true)).toMatchObject({ changed: true, state: "LOCKED", manualVersion: 1 });
    expect(await readSchoolSubscription(pool, a)).toMatchObject({ status: "PAID", schoolLocked: false });
    expect(await readSchoolEnforcementSummary(pool, a)).toMatchObject({ status: "PAID", schoolEnforcementStatus: "LOCKED", schoolLocked: true, studentsAffected: 2, cardsLocked: 2, devicesLocked: 1, teacherCardsLocked: 1, teachersAffected: 1 });
  });
  it("blocks paid students, their parents and reader use under an Owner lock", async () => {
    await expect(assertSubscriptionAccess(a, paid)).rejects.toMatchObject({ eventType: "SCHOOL_SUBSCRIPTION_LOCKED" });
    await expect(assertSubscriptionAccess(a)).rejects.toMatchObject({ eventType: "SCHOOL_SUBSCRIPTION_LOCKED" });
    for (const suffix of ["attendance","results","timetable"]) {
      await expect(enforceRequestSubscription(request(`/api/academic/parents/children/${paid}/${suffix}`), parentContext())).rejects.toMatchObject({ eventType: "SCHOOL_SUBSCRIPTION_LOCKED" });
    }
    await expect(enforceRequestSubscription(request("/api/communication/parent/threads", { studentId: paid }, "POST"), parentContext())).rejects.toMatchObject({ eventType: "SCHOOL_SUBSCRIPTION_LOCKED" });
  });
  it("does not let a locked-school teacher bypass enforcement using a foreign schoolId hint", async () => {
    const teacher = { ...parentContext(), roles: [{ id: 3, role: "TEACHER" as const, schoolId: a, status: "ACTIVE" as const }] };
    await expect(enforceRequestSubscription(request("/api/academic/me/assignments", { schoolId: b }, "POST"), teacher)).rejects.toMatchObject({ eventType: "SCHOOL_SUBSCRIPTION_LOCKED" });
  });
  it("blocks school academic operations for an ordinary Admin while preserving payment calendars", async () => {
    const admin = { ...parentContext(), roles: [{ id: 3, role: "SCHOOL_ADMIN" as const, schoolId: a, status: "ACTIVE" as const }] };
    await expect(enforceRequestSubscription(request("/api/academic/assignments", { schoolId: a }, "POST"), admin)).rejects.toMatchObject({ eventType: "SCHOOL_SUBSCRIPTION_LOCKED" });
    await expect(enforceRequestSubscription(request("/api/academic/terms", { schoolId: a }), admin)).resolves.toBeUndefined();
  });
  it("keeps School B independently available and child-specific under School A's lock", async () => {
    const combined = { ...parentContext(), roles: [...parentContext().roles, { id: 3, role: "TEACHER" as const, schoolId: a, status: "ACTIVE" as const }] };
    await expect(assertSubscriptionAccess(b)).resolves.toBeUndefined();
    await expect(enforceRequestSubscription(request(`/api/academic/parents/children/${other}/results`), combined)).rejects.toMatchObject({ eventType: "SUBSCRIPTION_REQUIRED" });
    expect((await readManualSchoolState(pool, b)).schoolEnforcementStatus).toBe("ACTIVE");
  });
  it("audits exact manual actor, state, reason, correlation and intended card/device scope", async () => {
    const log = (await q("SELECT actor_user_id,metadata FROM audit_logs WHERE school_id=$1 AND event_type='SCHOOL_LOCKED' ORDER BY id DESC LIMIT 1", [a]))[0];
    expect(log.actor_user_id).toBe(ownerUser);
    expect(log.metadata).toMatchObject({
      previousState: "ACTIVE", newState: "LOCKED", reason: "Isolated verification", requestId: "isolated-request",
      affectedScope: { students: 2, cardsLocked: 2, devicesLocked: 1, teacherCardsLocked: 1, teachersAffected: 1 },
    });
    expect(await protectedHashes()).toEqual(preserved);
  });
  it("audits accepted no-op manual actions without repeating notifications", async () => {
    const notices = Number((await q("SELECT count(*) n FROM communication_notifications WHERE school_id=$1", [a]))[0].n);
    const audits = Number((await q("SELECT count(*) n FROM audit_logs WHERE school_id=$1 AND event_type='SCHOOL_LOCKED'", [a]))[0].n);
    expect((await manual(a, true)).changed).toBe(false);
    expect(Number((await q("SELECT count(*) n FROM communication_notifications WHERE school_id=$1", [a]))[0].n)).toBe(notices);
    expect(Number((await q("SELECT count(*) n FROM audit_logs WHERE school_id=$1 AND event_type='SCHOOL_LOCKED'", [a]))[0].n)).toBe(audits + 1);
  });
  it("never removes an Owner lock during automatic evaluation or verified-payment restoration", async () => {
    await q("UPDATE subscriptions SET verification_status='pending' WHERE student_id=$1", [unpaid]);
    await reconcileSchoolSubscription(a, "AUTOMATIC_TERM_ENFORCEMENT");
    await q("UPDATE subscriptions SET verification_status='verified' WHERE student_id=$1", [unpaid]);
    await reconcileSchoolSubscription(a, "SUBSCRIPTION_PAYMENT_RESTORATION");
    expect((await readManualSchoolState(pool, a)).manualVersion).toBe(1);
    await expect(assertSubscriptionAccess(a, unpaid)).rejects.toMatchObject({ eventType: "SCHOOL_SUBSCRIPTION_LOCKED" });
  });
  it("preserves an Owner lock when the calendar is unavailable", async () => {
    await q("UPDATE academic_terms SET is_current=false WHERE id=$1", [termA]);
    expect(await readSchoolSubscription(pool, a)).toBeNull();
    await expect(assertSubscriptionAccess(a, paid)).rejects.toMatchObject({ eventType: "SCHOOL_SUBSCRIPTION_LOCKED" });
    expect(await readSchoolEnforcementSummary(pool, a)).toMatchObject({ status: "UNAVAILABLE", schoolEnforcementStatus: "LOCKED" });
    await q("UPDATE academic_terms SET is_current=true WHERE id=$1", [termA]);
  });
  it("does not interpret an unreadable manual state as ACTIVE", async () => {
    const unavailable = { query: async () => { throw new Error("Isolated DB outage"); } };
    await expect(assertSubscriptionAccess(a, paid, unavailable)).rejects.toMatchObject({ statusCode: 503, eventType: "SUBSCRIPTION_STATUS_UNAVAILABLE" });
    expect((await readManualSchoolState(pool, a)).schoolEnforcementStatus).toBe("LOCKED");
  });
  it("rejects stale manual versions without changing the school or appending an action audit", async () => {
    const n = (await q("SELECT count(*) n FROM audit_logs WHERE school_id=$1", [a]))[0].n;
    await expect(changeManualSchoolLock(a, false, actor(), 0)).rejects.toMatchObject({ statusCode: 409 });
    expect((await readManualSchoolState(pool, a)).schoolLocked).toBe(true);
    expect((await q("SELECT count(*) n FROM audit_logs WHERE school_id=$1", [a]))[0].n).toBe(n);
  });
  it("unlocks immediately but leaves unpaid students independently restricted", async () => {
    await q("UPDATE subscriptions SET verification_status='pending' WHERE student_id=$1", [unpaid]);
    await reconcileSchoolSubscription(a, "AUTOMATIC_TERM_ENFORCEMENT");
    expect(await manual(a, false)).toMatchObject({ changed: true, state: "ACTIVE", manualVersion: 2 });
    await expect(assertSubscriptionAccess(a, paid)).resolves.toBeUndefined();
    await expect(assertSubscriptionAccess(a)).resolves.toBeUndefined();
    await expect(assertSubscriptionAccess(a, unpaid)).rejects.toMatchObject({ eventType: "SUBSCRIPTION_REQUIRED" });
    expect(await readManualSchoolState(pool, a)).toMatchObject({ lockedByUserId: ownerUser, lastUnlockedByUserId: ownerUser });
    const log = (await q("SELECT metadata FROM audit_logs WHERE school_id=$1 AND event_type='SCHOOL_UNLOCKED' ORDER BY id DESC LIMIT 1", [a]))[0];
    expect(log.metadata).toMatchObject({ previousState: "LOCKED", newState: "ACTIVE", requestId: "isolated-request" });
  });
  it("does not reactivate independently lost, revoked, locked cards or inactive readers/accounts", async () => {
    await q("UPDATE app_users SET status='INACTIVE' WHERE id=$1", [parentUser]);
    await q("UPDATE platform_devices SET status='INACTIVE' WHERE school_id=$1", [a]);
    await manual(a, true);
    await manual(a, false);
    expect((await q("SELECT status FROM nfc_cards WHERE school_id=$1 ORDER BY id", [a])).map(r => r.status)).toEqual(["active","active","lost","blocked","locked","active"]);
    expect((await q("SELECT status FROM employee_nfc_card_bindings WHERE school_id=$1", [a]))[0].status).toBe("ACTIVE");
    expect((await q("SELECT status FROM platform_devices WHERE school_id=$1", [a]))[0].status).toBe("INACTIVE");
    expect((await q("SELECT status FROM app_users WHERE id=$1", [parentUser]))[0].status).toBe("INACTIVE");
    await q("UPDATE app_users SET status='ACTIVE' WHERE id=$1", [parentUser]);
  });
  it("does not manufacture a new restriction from unknown current-term verification", async () => {
    await q("UPDATE subscriptions SET verification_status='unrecognized' WHERE student_id=$1", [paid]);
    expect(await readSchoolSubscription(pool, a)).toMatchObject({ status: "UNAVAILABLE", restrictedStudentIds: [unpaid] });
    await expect(assertSubscriptionAccess(a, paid)).resolves.toBeUndefined();
    await q("UPDATE subscriptions SET verification_status='verified' WHERE student_id=$1", [paid]);
  });
  it("retains an already confirmed student restriction during unknown verification", async () => {
    await q("UPDATE subscriptions SET verification_status='unrecognized' WHERE student_id=$1", [unpaid]);
    expect((await readSchoolSubscription(pool, a))?.restrictedStudentIds).toEqual([unpaid]);
    await q("UPDATE subscriptions SET verification_status='pending' WHERE student_id=$1", [unpaid]);
  });
  it("allows explicit Owner locking and unlocking during grace", async () => {
    await q(`UPDATE academic_terms SET start_date=${today} WHERE id=$1`, [termA]);
    expect((await readSchoolSubscription(pool, a))?.inGracePeriod).toBe(true);
    await manual(a, true);
    await expect(assertSubscriptionAccess(a, paid)).rejects.toMatchObject({ eventType: "SCHOOL_SUBSCRIPTION_LOCKED" });
    await manual(a, false);
    await expect(assertSubscriptionAccess(a, unpaid)).resolves.toBeUndefined();
    await q(`UPDATE academic_terms SET start_date=${today}-10 WHERE id=$1`, [termA]);
  });
  it("the next term does not inherit payments and starts with fresh grace", async () => {
    await manual(a, true);
    await q("UPDATE academic_terms SET is_current=false WHERE id=$1", [termA]);
    await q(`INSERT INTO academic_terms(school_id,academic_session_id,name,start_date,end_date,status,is_current)
      SELECT school_id,academic_session_id,'Next Term',${today},${today}+60,'ACTIVE',true FROM academic_terms WHERE id=$1`, [termA]);
    expect(await readSchoolSubscription(pool, a)).toMatchObject({ inGracePeriod: true, studentsPaid: 0, studentsAffected: 0 });
    await reconcileSchoolSubscription(a, "AUTOMATIC_TERM_ENFORCEMENT");
    await expect(assertSubscriptionAccess(a, paid)).rejects.toMatchObject({ eventType: "SCHOOL_SUBSCRIPTION_LOCKED" });
    await manual(a, false);
    await expect(assertSubscriptionAccess(a, paid)).resolves.toBeUndefined();
  });
  it("an eligibility outage preserves known current restrictions without carrying old-term locks forward", async () => {
    const unavailable = new Proxy(pool, {
      get(target, property) {
        if (property === "query") return async (sql: string, args: unknown[]) => {
          if (sql.includes("FROM schools sc")) throw new Error("Synthetic eligibility outage");
          return target.query(sql, args);
        };
        return Reflect.get(target, property);
      },
    });
    await expect(assertSubscriptionAccess(b, other, unavailable)).rejects.toMatchObject({ eventType: "SUBSCRIPTION_REQUIRED" });
    await expect(assertSubscriptionAccess(a, unpaid, unavailable)).resolves.toBeUndefined();
  });
});