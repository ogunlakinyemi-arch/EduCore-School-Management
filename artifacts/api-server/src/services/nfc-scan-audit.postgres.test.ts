import { Pool } from "pg";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { listCapturedUids, inventoryFilters } from "./owner-uid-inventory";
import { listScanAudit, recordNfcDiagnostic, scanAuditFilters } from "./nfc-scan-audit";
import { prepareCapturedUid } from "./uid-inventory-assignment";

// Never use DATABASE_URL, application credentials or shared data.
const socket=process.env.NFC_SCAN_TEST_SOCKET;
describe.skipIf(!socket)("NFC discovery and audit on disposable PostgreSQL",()=>{
  let db:Pool;
  beforeAll(async()=>{
    if(!socket?.startsWith("/tmp/educore-scan-audit-") || process.env.REPLIT_DEPLOYMENT)
      throw Error("Disposable scan fixture required");
    db=new Pool({host:socket,port:55443,user:"nfc_scan_fixture",database:"nfc_scan_fixture",max:4});
    const identity=(await db.query(`SELECT current_database() db,current_user role,
      inet_server_addr() address,current_setting('data_directory') directory`)).rows[0];
    if(identity.db!=="nfc_scan_fixture" || identity.role!=="nfc_scan_fixture" ||
      identity.address!==null || identity.directory!==`${socket}/data`) throw Error("Unsafe fixture target");
    await db.query(`
      DROP TABLE IF EXISTS schools,platform_devices,nfc_cards,audit_logs;
      CREATE TABLE schools(id int PRIMARY KEY,name text);
      CREATE TABLE platform_devices(id int PRIMARY KEY,school_id int,name text,serial_number text);
      CREATE TABLE nfc_cards(id serial PRIMARY KEY,uid text,school_id int,student_id int,status text);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text,role text,actor_user_id int,school_id int,
        action text,module text,record_id int,event_type text,result text,metadata jsonb,
        "timestamp" timestamptz DEFAULT clock_timestamp());
      INSERT INTO schools VALUES(7,'Original school'),(8,'New school');
      INSERT INTO platform_devices VALUES(3,7,'School terminal','fixture-school'),(4,null,'Owner reader','fixture-owner');
    `);
  });
  afterAll(async()=>{await db?.end();});
  beforeEach(async()=>{await db.query("TRUNCATE audit_logs,nfc_cards");await db.query("UPDATE platform_devices SET school_id=7 WHERE id=3");});
  const school=async(eventId:string,uid="AABBCCDD",result="DENIED")=>{
    await db.query(`INSERT INTO audit_logs(school_id,action,module,record_id,event_type,result,metadata)
      VALUES(7,'NFC terminal event receipt','Attendance',3,'NFC_TERMINAL_EVENT',$1,$2::jsonb)`,
    [result,JSON.stringify({eventId,occurredAt:"2026-11-02T10:00:00Z",scan:{
      uid,schoolName:"Original school",deviceName:"School terminal",registeredAtScan:false,
      reason:result==="DENIED"?"CARD_INELIGIBLE":"ATTENDANCE_ACCEPTED"}})]);
  };
  const owner=async(uid="AABBCCDD")=>{
    await db.query(`INSERT INTO audit_logs(action,module,record_id,event_type,result,metadata)
      VALUES('Owner reader UID captured','UIDInventory',4,'OWNER_UID_READER_REPORT','SUCCESS',$1::jsonb)`,
    [JSON.stringify({uid,rawUid:uid.toLowerCase(),eventId:"owner-1",occurredAt:"2026-11-02T10:01:00Z",
      scanStatus:"UNKNOWN_UNASSIGNED",registeredAtScan:false})]);
  };
  const inventory=()=>listCapturedUids(db,inventoryFilters({}));
  const audit=(q={})=>listScanAudit(db,scanAuditFilters.parse({view:"scans",...q}));
  it("discovers a denied unknown UID without creating a card",async()=>{
    await school("unknown");
    expect((await inventory()).inventory).toMatchObject([{uid:"AABBCCDD",scanCount:1,
      assigned:false,registrationStatus:"Pending Registration",source:"SCHOOL",sourceSchoolId:7}]);
    expect((await db.query("SELECT count(*) FROM nfc_cards")).rows[0].count).toBe("0");
    expect((await audit()).rows).toMatchObject([{uid:"AABBCCDD",kind:"SCAN",outcome:"DENIED",registration:"UNREGISTERED"}]);
  });
  it("unifies Owner and school discovery into exactly one canonical entry",async()=>{
    await school("one");await owner();
    const data=await inventory();
    expect(data.total).toBe(1);expect(data.inventory[0].scanCount).toBe(2);
    expect((await audit()).scanTotal).toBe(2);
  });
  it("repeated physical taps increase detections; retries and malformed reports do not",async()=>{
    await school("one");await school("two");
    await recordNfcDiagnostic(db,{deviceId:3,schoolId:7,source:"SCHOOL",kind:"RETRY",
      reason:"EXACT_RETRY",eventId:"one",uid:"aabbccdd"});
    await recordNfcDiagnostic(db,{deviceId:3,schoolId:7,source:"SCHOOL",kind:"MALFORMED",
      reason:"MALFORMED_REPORT",uid:"invalid"});
    const data=await inventory();
    expect(data.total).toBe(1);expect(data.inventory[0].scanCount).toBe(2);
    const reports=await audit();
    expect(reports.total).toBe(4);expect(reports.scanTotal).toBe(2);
    expect((await audit({kind:"MALFORMED"})).rows[0].uid).toBeNull();
  });
  it.each(["active","locked","lost","inactive"])("never changes an existing %s card",async(status)=>{
    await db.query("INSERT INTO nfc_cards(uid,school_id,student_id,status) VALUES('aabbccdd',7,91,$1)",[status]);
    await school("registered");
    expect((await inventory()).inventory[0]).toMatchObject({assigned:true,status,studentId:91});
    expect((await audit()).rows[0]).toMatchObject({registration:"REGISTERED",registeredAtScan:false});
    expect((await db.query("SELECT uid,status FROM nfc_cards")).rows).toEqual([{uid:"aabbccdd",status}]);
  });
  it("preserves event school after reassignment and supports school/device/source filtering",async()=>{
    await school("old");await owner("11223344");
    await db.query("UPDATE platform_devices SET school_id=8 WHERE id=3");
    const data=await audit({schoolId:7,deviceId:3,source:"SCHOOL"});
    expect(data.total).toBe(1);
    expect(data.rows[0]).toMatchObject({schoolId:7,schoolName:"Original school"});
    expect((await audit({schoolId:8})).total).toBe(0);
  });
  it("paginates with an accurate total including empty pages; UID search is escaped",async()=>{
    await school("one");await owner("11223344");
    expect((await audit({pageSize:1,page:1})).rows).toHaveLength(1);
    expect((await audit({pageSize:1,page:2})).rows).toHaveLength(1);
    const empty=await audit({pageSize:1,page:3});expect(empty.rows).toHaveLength(0);expect(empty.total).toBe(2);
    expect((await audit({q:"AABB"})).total).toBe(1);
    expect((await audit({q:"%"})).total).toBe(0);
    expect((await audit({registration:"REGISTERED"})).total).toBe(0);
  });
  it("includes diagnostics but excludes them from physical scan totals",async()=>{
    await db.query(`INSERT INTO audit_logs(action,module,record_id,result,metadata)
      VALUES('Owner reader status reported','UIDInventory',4,'SUCCESS','{"scanStatus":"READY"}')`);
    expect((await audit()).total).toBe(1);expect((await audit()).scanTotal).toBe(0);
    expect((await audit({kind:"HEARTBEAT"})).rows).toMatchObject([{uid:null,kind:"HEARTBEAT"}]);
    expect((await inventory()).total).toBe(0);
  });
  it("authorizes explicit registration from school discovery without automatic assignment",async()=>{
    await school("available");
    const client=await db.connect();
    try {
      await client.query("BEGIN");
      expect(await prepareCapturedUid(client,"aabbccdd",7)).toMatchObject({uid:"AABBCCDD",school_id:7});
      expect((await client.query("SELECT student_id,status FROM nfc_cards")).rows).toEqual([{student_id:null,status:"unassigned"}]);
      await client.query("ROLLBACK");
    } finally {client.release();}
  });
  it("rejects registration provenance from diagnostics and already-registered cards",async()=>{
    await recordNfcDiagnostic(db,{deviceId:3,schoolId:7,source:"SCHOOL",kind:"RETRY",reason:"EXACT_RETRY",uid:"AABBCCDD"});
    const client=await db.connect();
    try {
      await client.query("BEGIN");
      await expect(prepareCapturedUid(client,"AABBCCDD",7)).rejects.toMatchObject({statusCode:409});
      await client.query("ROLLBACK");
      await school("registered");
      await db.query("INSERT INTO nfc_cards(uid,school_id,status) VALUES('aabbccdd',7,'lost')");
      await client.query("BEGIN");
      await expect(prepareCapturedUid(client,"AABBCCDD",7)).rejects.toMatchObject({statusCode:409});
      await client.query("ROLLBACK");
    } finally {client.release();}
  });
});
