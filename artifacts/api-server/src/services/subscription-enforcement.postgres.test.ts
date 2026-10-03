import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { assertSubscriptionAccess, readSchoolSubscription, reconcileSchoolSubscription } from "./subscription-enforcement";
import { enforceRequestSubscription } from "./subscription-request-access";
import type { Request } from "express";
import type { UserContext } from "../middlewares/auth";

const native = process.env.RUN_SUBSCRIPTION_ENFORCEMENT_POSTGRES === "1";
describe.skipIf(!native)("subscription enforcement in disposable PostgreSQL", () => {
  let a: number, b: number, termA: number, termB: number;
  let paid: number, unpaid: number, other: number, parentUser: number, parentA: number, parentB: number;
  const today = "(NOW() AT TIME ZONE 'Africa/Lagos')::date";
  const q = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows;
  beforeAll(async () => {
    const identity = (await q("SELECT current_setting('data_directory') dir,inet_server_addr() host"))[0];
    if (identity.dir !== "/tmp/educore-enforcement-pg" || identity.host !== null) throw Error("Disposable database only");
    const migration = await readFile("../../lib/db/drizzle/0049_term_subscription_enforcement.sql", "utf8");
    await pool.query(migration);
    await pool.query(migration);
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
  it("migration replays safely and enforces tenant-bound term foreign keys", async () => {
    await expect(q("INSERT INTO school_subscription_enforcement(school_id,academic_term_id,snapshot) VALUES($1,$2,'{}')", [a, termB])).rejects.toMatchObject({ code: "23503" });
  });
  it("unverified checkouts do not cover students", async () => {
    await q(`INSERT INTO subscriptions(school_id,student_id,term,status,verification_status,expires_at)
      SELECT $1,$2,name,'active','pending',(end_date+1)::timestamptz FROM academic_terms WHERE id=$3`, [a, paid, termA]);
    expect(await readSchoolSubscription(pool, a)).toMatchObject({ schoolLocked: true, studentsPaid: 0, studentsAffected: 2, devicesLocked: 1 });
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
    expect((await q("SELECT status FROM nfc_cards WHERE school_id=$1 ORDER BY id", [a])).map(r => r.status)).toEqual(["active", "active", "lost", "blocked", "locked"]);
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
  it("keeps partial-school teachers active and blocks fully unpaid teaching operations", async () => {
    const teacher = (schoolId: number): UserContext => ({ ...parentContext(), roles: [{ id: 3, role: "TEACHER", schoolId, status: "ACTIVE" }] });
    for (const endpoint of ["attendance", "lesson-notes", "curriculum"]) {
      await expect(enforceRequestSubscription(request(`/api/schools/${b}/${endpoint}`, {}, "POST"), teacher(b))).rejects.toMatchObject({ eventType: "SUBSCRIPTION_REQUIRED" });
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
    expect((await q("SELECT status FROM nfc_cards WHERE school_id=$1 ORDER BY id", [a])).map(r => r.status)).toEqual(["active", "active", "lost", "blocked", "locked"]);
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
    await expect(reconcileSchoolSubscription(b, "OWNER_MANUAL_LOCK", undefined, termA)).rejects.toMatchObject({ statusCode: 409 });
    expect((await q("SELECT count(*) n FROM school_subscription_enforcement WHERE school_id=$1", [b]))[0].n).toBe("0");
  });
  it("queues an owned cross-school parent's restriction through the existing notification engine", async () => {
    expect((await reconcileSchoolSubscription(b, "AUTOMATIC_TERM_ENFORCEMENT")).changed).toBe(true);
    expect((await q("SELECT count(*) n FROM communication_notifications WHERE school_id=$1 AND recipient_user_id=$2 AND subject_student_id=$3", [b, parentUser, other]))[0].n).toBe("1");
  });
  it("the next term does not inherit payments and starts with fresh grace", async () => {
    await q("UPDATE academic_terms SET is_current=false WHERE id=$1", [termA]);
    await q(`INSERT INTO academic_terms(school_id,academic_session_id,name,start_date,end_date,status,is_current)
      SELECT school_id,academic_session_id,'Next Term',${today},${today}+60,'ACTIVE',true FROM academic_terms WHERE id=$1`, [termA]);
    expect(await readSchoolSubscription(pool, a)).toMatchObject({ inGracePeriod: true, studentsPaid: 0, studentsAffected: 0 });
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