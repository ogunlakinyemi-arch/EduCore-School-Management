import express from "express";
import { Pool } from "pg";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state=vi.hoisted(()=>({db:null as any,deny:false}));
vi.mock("@workspace/db",()=>({pool:{
  query:(...args:any[])=>state.db.query(...args),connect:()=>state.db.connect(),
}}));
// Real ingestion route + real PostgreSQL transactions/savepoints; downstream
// attendance is a controlled writer so rollback of ALL effects is observable.
vi.mock("./attendance",async()=>{
  const {AuthError}=await import("../middlewares/auth");
  return {
    deviceAuth:async(_req:any,token:string)=>{
      if(token!=="fixture.only-test")throw new AuthError(401,"Invalid or inactive device credential");
      return {deviceId:3,schoolId:7,credentialId:1};
    },
    handleDeviceAttendance:async(_req:any,res:any,{client}:any)=>{
      for(const table of ["attendance_events","attendance_notification_events","security_events"])
        await client.query(`INSERT INTO ${table}(marker) VALUES('fixture')`);
      if(state.deny)throw new AuthError(403,"NFC card is invalid for this student or school");
      res.status(201).json({id:1,eventType:"SCHOOL_ENTRY"});
    },
  };
});
import router from "./terminal-events";
const socket=process.env.NFC_SCAN_TEST_SOCKET;
describe.skipIf(!socket)("real PostgreSQL scan receipt transaction boundaries",()=>{
  let db:Pool,server:ReturnType<ReturnType<typeof express>["listen"]>,base:string;
  beforeAll(async()=>{
    if(!socket?.startsWith("/tmp/educore-scan-audit-")||process.env.REPLIT_DEPLOYMENT)throw Error("Disposable fixture required");
    db=new Pool({host:socket,port:55443,user:"nfc_scan_fixture",database:"nfc_scan_route_fixture"});
    const row=(await db.query(`SELECT current_database() db,current_user role,inet_server_addr() address,
      current_setting('data_directory') directory`)).rows[0];
    if(row.db!=="nfc_scan_route_fixture"||row.role!=="nfc_scan_fixture"||row.address!==null||
      row.directory!==`${socket}/data`)throw Error("Wrong disposable identity");
    state.db=db;
    await db.query(`
      DROP TABLE IF EXISTS schools,platform_devices,device_credentials,nfc_cards,audit_logs,
        attendance_events,attendance_notification_events,security_events;
      CREATE TABLE schools(id int PRIMARY KEY,name text);
      CREATE TABLE platform_devices(id int PRIMARY KEY,school_id int,status text,configuration_status text,device_type text,name text);
      CREATE TABLE device_credentials(id int PRIMARY KEY,device_id int,school_id int,status text,expires_at timestamptz);
      CREATE TABLE nfc_cards(id serial PRIMARY KEY,uid text);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text,role text,school_id int,action text,module text,
        record_id int,event_type text,result text,metadata jsonb,"timestamp" timestamptz DEFAULT clock_timestamp());
      CREATE TABLE attendance_events(id serial PRIMARY KEY,marker text);
      CREATE TABLE attendance_notification_events(id serial PRIMARY KEY,marker text);
      CREATE TABLE security_events(id serial PRIMARY KEY,marker text);
      INSERT INTO schools VALUES(7,'Fixture school');
      INSERT INTO platform_devices VALUES(3,7,'ACTIVE','CONFIGURED','NFC','Fixture terminal');
      INSERT INTO device_credentials VALUES(1,3,7,'ACTIVE',NULL);
    `);
    const app=express();app.use("/api",router);
    await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>resolve());});
    base=`http://127.0.0.1:${(server.address() as any).port}/api/v1/terminal/events`;
  });
  afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await db?.end();});
  beforeEach(async()=>{
    state.deny=false;
    await db.query("TRUNCATE audit_logs,nfc_cards,attendance_events,attendance_notification_events,security_events");
    await db.query(`INSERT INTO audit_logs(action,module,record_id,metadata)
      VALUES('Configured NFC terminal direction','Devices',3,'{"terminalDirection":"ENTRY","schoolId":7}')`);
  });
  const body=(extra={})=>({device_id:"EDUCORE03",school_id:"SCH07",uid:"aabbccdd",event_id:"scan-1",
    event_type:"CARD_SCAN",timestamp:new Date().toISOString(),...extra});
  async function send(event:any,key="fixture.only-test"){
    const r=await fetch(base,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},
      body:JSON.stringify(event)});return {status:r.status,body:await r.json() as any};
  }
  it("retains denied UID evidence while rolling back attendance, notifications and security",async()=>{
    state.deny=true;
    expect(await send(body())).toMatchObject({status:200,body:{success:false,action:"DENIED"}});
    for(const table of ["attendance_events","attendance_notification_events","security_events"])
      expect((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe("0");
    const row=(await db.query("SELECT metadata FROM audit_logs WHERE event_type='NFC_TERMINAL_EVENT'")).rows[0];
    expect(row.metadata.scan).toMatchObject({uid:"AABBCCDD",registeredAtScan:false,reason:"CARD_INELIGIBLE"});
  });
  it("keeps accepted processing and its receipt in one transaction",async()=>{
    expect(await send(body())).toMatchObject({status:200,body:{success:true}});
    expect((await db.query("SELECT count(*) FROM attendance_events")).rows[0].count).toBe("1");
    expect((await db.query("SELECT metadata FROM audit_logs WHERE event_type='NFC_TERMINAL_EVENT'")).rows[0].metadata.scan.uid).toBe("AABBCCDD");
  });
  it("separates exact retries from new taps and refuses conflicting payload reuse",async()=>{
    state.deny=true;const event=body();
    await send(event);expect((await send(event)).body.duplicate).toBe(true);
    await send({...event,event_id:"scan-2"});
    expect((await send({...event,uid:"11223344"})).status).toBe(409);
    expect((await db.query("SELECT count(*) FROM audit_logs WHERE event_type='NFC_TERMINAL_EVENT'")).rows[0].count).toBe("2");
    expect((await db.query("SELECT metadata FROM audit_logs WHERE result='RETRY'")).rows[0].metadata.reason).toBe("EXACT_RETRY");
  });
  it("stores no UID for malformed reports and nothing for unauthenticated attempts",async()=>{
    expect((await send(body({uid:"invalid"}))).status).toBe(400);
    const logs=(await db.query("SELECT metadata FROM audit_logs WHERE module='NFCScanAudit'")).rows;
    expect(logs).toHaveLength(1);expect(logs[0].metadata.uid).toBeNull();
    await db.query("DELETE FROM audit_logs WHERE module='NFCScanAudit'");
    await send(body({uid:"invalid"}),"wrong.key");
    expect((await db.query("SELECT count(*) FROM audit_logs WHERE module='NFCScanAudit'")).rows[0].count).toBe("0");
  });
  it("rolls back accepted attendance if its mandatory receipt cannot persist",async()=>{
    await db.query(`CREATE OR REPLACE FUNCTION fixture_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type='NFC_TERMINAL_EVENT' THEN RAISE EXCEPTION 'fixture receipt unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_receipt_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_receipt_failure()`);
    try {
      expect((await send(body())).status).toBe(503);
      for(const table of ["attendance_events","attendance_notification_events","security_events"])
        expect((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe("0");
    } finally {await db.query("DROP TRIGGER fixture_receipt_failure ON audit_logs; DROP FUNCTION fixture_receipt_failure()");}
  });
});
