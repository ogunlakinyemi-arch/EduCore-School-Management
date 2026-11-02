import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "PLATFORM_OWNER",
  card: { id: 31, schoolId: 1, uid: "NFC-31", studentId: 10 as number | null, status: "locked", scans: 0, lastScan: null as Date | null },
  employeeBindingId: null as number | null,
  students: new Map<number, { id: number; schoolId: number; firstName: string; lastName: string }>(),
  duplicateActiveBinding: false,
  deviceAvailable: true,
  schoolExists: true,
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  paymentVerified:true,schoolRestricted:false,lockAction:"REGISTERED",lockReason:null as string|null,today:"2027-01-18",
}));
vi.mock("../services/student-platform-rollout",async original=>{
  const actual=await original<typeof import("../services/student-platform-rollout")>();
  return {...actual,lagosDate:()=>state.today,
    readStudentRollout:(db:any,schoolId:number,termId?:number,today=state.today)=>actual.readStudentRollout(db,schoolId,termId,today)};
});
vi.mock("../services/subscription-enforcement",async()=>{
  return {assertSubscriptionAccess:vi.fn(async()=>{
    if(state.schoolRestricted){
      const {AuthError}=await import("../middlewares/auth");
      throw new AuthError(403,"School manually locked","SCHOOL_SUBSCRIPTION_LOCKED");
    }
  })};
});

const poolMock = vi.hoisted(() => {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    return { rows: [] };
  });
  const connect = vi.fn(async () => ({
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if(sql.includes('s.status AS "sessionStatus"'))return {rows:[
        {id:19,schoolId:1,name:"First Term",startDate:"2026-09-01",endDate:"2026-12-20",
          isCurrent:state.today<"2027-01-18",status:"ACTIVE",sessionStatus:"ACTIVE"},
        {id:20,schoolId:1,name:"Second Term",startDate:"2027-01-18",endDate:"2027-04-09",
          isCurrent:state.today>="2027-01-18",status:"ACTIVE",sessionStatus:"ACTIVE"},
      ]};
      if(sql.includes("AS nfc_payment_verified"))return {rows:[{nfc_payment_verified:state.paymentVerified}]};
      if(sql.includes('AS "assignmentVersion"'))return {rows:[{version:1,assignmentVersion:1,now:new Date().toISOString(),events:[],latestGrace:null}]};
      if(sql.includes('nc.student_id AS "studentId"') && sql.includes('AS "currentCards"'))
        return {rows:[{...state.card,studentStatus:"ACTIVE",schoolStatus:"ACTIVE",employeeBindings:0,currentCards:1}]};
      if(sql.includes("SELECT action,reason,previous_status"))return {rows:[{action:state.lockAction,reason:state.lockReason}]};
      if(sql.includes("UPDATE nfc_cards") && sql.includes("SET status = $1")){
        state.card.status=String(values[0]);return {rows:[{...state.card}]};
      }
      if(sql.includes("SELECT id FROM schools WHERE id=$1")) return {rows:state.schoolExists?[{id:values[0]}]:[]};
      if(sql.includes("FROM platform_devices d")) return {rows:state.deviceAvailable?[{id:501}]:[]};
      if (sql.includes('SELECT nc.id, nc.school_id AS "schoolId"')) {
        return { rows: Number(values[0])===state.card.id ? [{ ...state.card, employeeBindingId: state.employeeBindingId }] : [] };
      }
      if (sql.includes('SELECT nc.school_id AS "schoolId"')) {
        return { rows: [{ ...state.card, employeeBindingId: state.employeeBindingId }] };
      }
      if (sql.includes("FROM nfc_cards WHERE lower(uid)=lower($1)"))return{rows:String(values[0]).toLowerCase()===state.card.uid.toLowerCase()?[{...state.card}]:[]};
      if (sql.includes("FROM students WHERE id = $1 AND school_id = $2") || sql.includes("FROM students WHERE id=$1 AND school_id=$2")) {
        const student = state.students.get(Number(values[0]));
        return { rows: student?.schoolId === Number(values[1]) ? [student] : [] };
      }
      if (sql.includes("SELECT id FROM nfc_cards") && sql.includes("status = 'active'")) {
        return { rows: state.duplicateActiveBinding ? [{ id: 99 }] : [] };
      }
      if(sql.includes("SELECT id FROM nfc_cards") && sql.includes("IN ('active','locked')")) {
        return {rows:state.duplicateActiveBinding?[{id:99}]:[]};
      }
      if (sql.includes("INSERT INTO nfc_cards")) {
        return {
          rows: [{
            id: 41,
            schoolId: Number(values[0]),
            uid: String(values[1]),
            studentId: values[2] ?? null,
            status: values[3],
            scans: 0,
            lastScan: null,
          }],
        };
      }
      if (sql.includes("UPDATE nfc_cards SET student_id")) {
        state.card.studentId = Number(values[0]);
        if(state.card.status==="unassigned") state.card.status="locked";
        return { rows: [{ ...state.card }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  }));
  return { query, connect };
});

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const role = state.role as any;
      (req as any).edupulseUser = {
        user: {
          id: 12,
          clerkUserId: `clerk-${role}`,
          email: `${role.toLowerCase()}@example.test`,
          firstName: "Test",
          lastName: "User",
          phone: null,
          status: "ACTIVE",
        },
        roles: [{
          id: 1,
          role,
          schoolId: role === "PLATFORM_OWNER" ? null : 1,
          status: "ACTIVE",
        }],
      };
      next();
    },
  };
});

import edupulseRouter from "./edupulse";

const app = express();
app.use(express.json());
app.use(edupulseRouter);

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  state.students.set(10, { id: 10, schoolId: 1, firstName: "Old", lastName: "Student" });
  state.students.set(11, { id: 11, schoolId: 1, firstName: "New", lastName: "Student" });
  state.students.set(20, { id: 20, schoolId: 2, firstName: "Other", lastName: "School" });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
));

beforeEach(() => {
  state.role = "PLATFORM_OWNER";
  state.card = { id: 31, schoolId: 1, uid: "NFC-31", studentId: 10, status: "locked", scans: 0, lastScan: null };
  state.employeeBindingId = null;
  state.duplicateActiveBinding = false;
  state.deviceAvailable = true;
  state.schoolExists = true;
  state.queries.length = 0;
  state.paymentVerified=true;state.schoolRestricted=false;state.lockAction="REGISTERED";state.lockReason=null;state.today="2027-01-18";
  poolMock.query.mockClear();
  poolMock.connect.mockClear();
});

const activate=(body:unknown)=>fetch(`${baseUrl}/cards/31/status`,{
  method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body),
});
it.each(["REGISTERED","ASSIGNED","REASSIGNED"])("activates unpaid %s cards through the Owner API in the free term",async action=>{
  state.today="2026-11-02";state.lockAction=action;state.paymentVerified=false;
  state.card.uid="6C98EABE";
  const response=await activate({status:"active",studentId:10,confirm:true,reason:"Free current-term launch activation"});
  expect(response.status).toBe(200);
  expect(state.card.status).toBe("active");
  expect(state.queries.some(q=>q.sql.includes("AS nfc_payment_verified"))).toBe(false);
  expect(state.queries.some(q=>/\b(INSERT|UPDATE|DELETE)\b/i.test(q.sql)&&/student_direct_live_|payment_receipts|fee_payments/.test(q.sql))).toBe(false);
  expect(state.queries.some(q=>q.sql.includes("INSERT INTO nfc_card_history"))).toBe(true);
});
it.each(["SCHOOL_ADMIN","TEACHER","STAFF"])("does not extend free activation authority to %s",async role=>{
  state.today="2026-11-02";state.role=role;state.paymentVerified=false;
  expect((await activate({status:"active",studentId:10,confirm:true,reason:"Unauthorized launch activation"})).status).toBe(403);
  expect(state.card.status).toBe("locked");
});
const activation={status:"active",studentId:10,confirm:true,reason:"Reviewed new UID and eligibility"};
describe("confirmed Owner activation does not bypass NFC restrictions",()=>{
  it.each(["SCHOOL_ADMIN","TEACHER","STAFF","PARENT","STUDENT","PARTNER","DEVICE_ACTIVATION_OFFICER","COMPANY_ACCOUNTANT"])("denies %s",async role=>{
    state.role=role;expect((await activate(activation)).status).toBe(403);
    expect(state.queries.some(q=>q.sql.includes("UPDATE nfc_cards"))).toBe(false);
  });
  it.each([{confirm:false},{reason:" "},{reason:undefined},{studentId:11}])("rejects missing confirmation/reason or stale student %j",async override=>{
    expect([400,409]).toContain((await activate({...activation,...override})).status);
    expect(state.queries.some(q=>q.sql.includes("UPDATE nfc_cards"))).toBe(false);
  });
  it.each(["lost","stolen","blocked","suspended","expired","replaced","inactive","unassigned"])("cannot reactivate %s",async status=>{
    state.card.status=status;
    expect((await activate(activation)).status).toBe(409);
    expect(state.queries.some(q=>q.sql.includes("UPDATE nfc_cards"))).toBe(false);
  });
  it("requires independent payment and does not turn a school-wide lock into a card unlock",async()=>{
    state.paymentVerified=false;
    expect((await activate(activation)).status).toBe(409);
    state.paymentVerified=true;state.schoolRestricted=true;
    const blocked=await activate(activation);
    expect({status:blocked.status,payload:await blocked.json()}).toEqual({status:409,payload:expect.objectContaining({error:"School manually locked"})});
    expect(state.queries.some(q=>q.sql.includes("UPDATE nfc_cards"))).toBe(false);
  });
  it("activates only the current card and appends the confirmed reason to card and audit history",async()=>{
    const result=await activate(activation);expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({id:31,uid:"NFC-31",studentId:10,status:"active"});
    const history=state.queries.find(q=>q.sql.includes("INSERT INTO nfc_card_history"))!;
    expect(history.values).toEqual([1,31,10,"locked","active",12,activation.reason]);
    const audit=state.queries.find(q=>q.sql.includes("INSERT INTO audit_logs"))!;
    expect(audit.values[11]).toMatchObject({
      previousStatus:"locked",newStatus:"active",reason:activation.reason,confirmed:true,studentId:10,uid:"NFC-31",
    });
  });
  it("retains a recorded security lock even after a reasoned explicit Owner request",async()=>{
    state.lockAction="STATUS_CHANGED";state.lockReason="Security review of card possession";
    expect(state.card.status).toBe("locked");
    const result=await activate({...activation,reason:"Security review completed; holder verified"});
    expect(result.status).toBe(409);
    expect(state.queries.some(q=>q.sql.includes("INSERT INTO nfc_card_history"))).toBe(false);
  });
});

async function reassign(studentId: number) {
  return fetch(`${baseUrl}/cards/31/reassign`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ studentId }),
  });
}

describe("NFC card reassignment", () => {
  it("rejects a manipulated unknown Card ID without changing an assignment",async()=>{
    const response=await fetch(`${baseUrl}/cards/999/reassign`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({studentId:11})});
    expect(response.status).toBe(404);
    expect(state.queries.some(q=>q.sql.includes("UPDATE nfc_cards"))).toBe(false);
  });
  it("assigns an available prepared card as locked and records its actual new status",async()=>{
    state.card.studentId=null;
    state.card.status="unassigned";
    const response=await reassign(11);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({id:31,studentId:11,status:"locked"});
    expect(state.queries.find(q=>q.sql.includes("INSERT INTO nfc_card_history"))?.values[7]).toBe("locked");
  });
  it("rejects new Student card assignment when the selected school has no eligible device",async()=>{
    state.deviceAvailable=false;
    const response=await fetch(`${baseUrl}/cards?schoolId=1`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({uid:"NEW-DEVICE-FIRST",studentId:11})});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:"NFC_DEVICE_REQUIRED"});
    expect(state.queries.some(q=>q.sql.includes("INSERT INTO nfc_cards"))).toBe(false);
  });
  it("rejects prepared-card reassignment without an active linked device",async()=>{
    state.deviceAvailable=false;
    expect((await reassign(11)).status).toBe(409);
    expect(state.queries.some(q=>q.sql.includes("UPDATE nfc_cards SET student_id"))).toBe(false);
  });
  it("rejects future activation of a legacy assigned card whose school has no device",async()=>{
    state.deviceAvailable=false;
    const response=await fetch(`${baseUrl}/cards/31/status`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status:"active",confirm:true,reason:"Activate prepared card",studentId:10})});
    expect(response.status).toBe(409);
    expect(state.queries.some(q=>q.sql.includes("SET status = $1"))).toBe(false);
  });
  it.each(["deviceId","deviceIds","device_id"])("rejects manually injected %s instead of binding a card to an arbitrary device",async key=>{
    const response=await fetch(`${baseUrl}/cards?schoolId=1`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({uid:"NEW-DEVICE-FIRST",studentId:11,[key]:999})});
    expect(response.status).toBe(400);
    expect(state.queries.some(q=>q.sql.includes("INSERT INTO nfc_cards"))).toBe(false);
  });
  it("rejects an unknown selected school before creating a card",async()=>{
    state.schoolExists=false;
    const response=await fetch(`${baseUrl}/cards?schoolId=999`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({uid:"NEW-DEVICE-FIRST",studentId:11})});
    expect(response.status).toBe(404);
  });
  it("rejects a mismatched explicit school context for prepared-card assignment",async()=>{
    const response=await fetch(`${baseUrl}/cards/31/reassign?schoolId=2`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({studentId:11})});
    expect(response.status).toBe(404);
  });
  it("rejects duplicate current Student assignments during registration",async()=>{
    state.duplicateActiveBinding=true;
    const response=await fetch(`${baseUrl}/cards?schoolId=1`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({uid:"NEW-DEVICE-FIRST",studentId:11})});
    expect(response.status).toBe(409);
  });
  it("requires a currently configured same-school NFC device and holds it through the assignment transaction",async()=>{
    expect((await reassign(11)).status).toBe(200);
    const deviceCheck=state.queries.find(q=>q.sql.includes("FROM platform_devices d"));
    expect(deviceCheck?.values).toEqual([1]);
    expect(deviceCheck?.sql).toContain("d.school_id=$1");
    expect(deviceCheck?.sql).toContain("upper(d.status)='ACTIVE'");
    expect(deviceCheck?.sql).toContain("d.configuration_status='CONFIGURED'");
    expect(deviceCheck?.sql).toContain("IN ('NFC','HYBRID')");
    expect(deviceCheck?.sql).toContain("b.school_id=d.school_id");
    expect(deviceCheck?.sql).toContain("FOR SHARE OF d");
    expect(state.queries.some(q=>q.sql.includes("INSERT INTO nfc_card_history"))).toBe(true);
  });
  it("projects an active employee card through the backward-compatible school cards list", async () => {
    state.role = "SCHOOL_ADMIN";
    poolMock.query.mockImplementationOnce(async () => ({
      rows: [{
        id: 41,
        schoolId: 1,
        uid: "EMPLOYEE-41",
        studentId: null,
        studentName: null,
        employeeId: 31,
        employeeName: "Tola Ade",
        personType: "TEACHER",
        status: "locked",
        scans: 0,
        lastScan: null,
      }] as unknown as never[],
    }));
    const response = await fetch(`${baseUrl}/cards?schoolId=1`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{
      id: 41,
      studentId: null,
      studentName: null,
      employeeId: 31,
      employeeName: "Tola Ade",
      personType: "TEACHER",
    }]);
    expect(poolMock.query.mock.calls.some(([sql]) =>
      String(sql).includes("employee_nfc_card_bindings") &&
      String(sql).includes('employee."employeeId"') &&
      String(sql).includes("b.school_id=nc.school_id"),
    )).toBe(true);
  });

  it("keeps physical card provisioning exclusive to the global Platform Owner", async () => {
    state.role = "SCHOOL_ADMIN";
    const response = await fetch(`${baseUrl}/cards?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: "NEW-PHYSICAL-CARD" }),
    });
    expect(response.status).toBe(403);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO nfc_cards"))).toBe(false);
  });

  it("retains physical card provisioning for the global Platform Owner", async () => {
    state.role = "PLATFORM_OWNER";
    const response = await fetch(`${baseUrl}/cards?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: "OWNER-PHYSICAL-CARD" }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      schoolId: 1,
      uid: "OWNER-PHYSICAL-CARD",
      studentId: null,
      status: "unassigned",
    });
    expect(state.queries.some(({ sql }) =>
      sql.includes("INSERT INTO nfc_cards (school_id, uid, student_id, status, issued_at)"),
    )).toBe(true);
  });

  it.each(["PLATFORM_OWNER"] as const)(
    "allows authorized %s reassignment while preserving the card's school",
    async (role) => {
      state.role = role;
      const response = await reassign(11);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: 31,
        schoolId: 1,
        studentId: 11,
        studentName: "New Student",
      });
      expect(state.card.schoolId).toBe(1);
      expect(state.queries.filter(({ sql }) => sql.includes("INSERT INTO nfc_card_history"))[0]?.values).toEqual(
        [1, 31, 10, "locked", "Card reassigned from student 10 to student 11", 12, 11, "locked"],
      );
      expect(state.queries.some(({ sql, values }) =>
        sql.includes("INSERT INTO audit_logs") && values.includes("NFC_CARD_REASSIGNED"),
      )).toBe(true);
    },
  );

  it.each(["SCHOOL_ADMIN", "STAFF", "TEACHER"] as const)("rejects non-owner %s reassignment", async (role) => {
    state.role = role;
    const response = await reassign(11);
    expect(response.status).toBe(403);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE nfc_cards SET student_id"))).toBe(false);
  });

  it("rejects cross-school students without changing the card", async () => {
    const response = await reassign(20);
    expect(response.status).toBe(404);
    expect(state.card.studentId).toBe(10);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE nfc_cards SET student_id"))).toBe(false);
  });

  it("rejects a target student who already has an active card", async () => {
    state.duplicateActiveBinding = true;
    const response = await reassign(11);
    expect(response.status).toBe(409);
    expect(state.card.studentId).toBe(10);
  });

  it("rejects replaced and unknown-status cards", async () => {
    state.card.status = "replaced";
    expect((await reassign(11)).status).toBe(409);
    state.card.status = "damaged";
    expect((await reassign(11)).status).toBe(409);
    expect(state.card.studentId).toBe(10);
  });

  it("rejects malformed student IDs", async () => {
    const response = await fetch(`${baseUrl}/cards/31/reassign`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentId: "11" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects employee-bound cards in student reassignment and activation workflows", async () => {
    state.card.studentId = null;
    state.employeeBindingId = 51;
    const response = await reassign(11);
    expect(response.status).toBe(409);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE nfc_cards SET student_id"))).toBe(false);

    const activation = await fetch(`${baseUrl}/cards/31/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    expect(activation.status).toBe(409);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE nfc_cards") && sql.includes("SET status = $1"))).toBe(false);
  });
});