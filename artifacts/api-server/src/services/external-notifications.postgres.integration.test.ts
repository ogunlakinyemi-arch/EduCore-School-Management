import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { pool } from "@workspace/db";
import { createSchoolRows } from "../../../../scripts/src/notification-fixture-seed.mjs";
import { queueCommunicationNotification, dispatchCommunicationDeliveries, emitDomainParentEvent } from "./communication-service";
import { MockEmailProvider, MockSmsProvider } from "./communication-test-providers";
import { MockPushProvider, WebPushProvider } from "./web-push-provider";
import type { CommunicationProviderAdapters } from "./communication-providers";
import { readFile } from "node:fs/promises";
import express from "express";
import { createHmac } from "node:crypto";
import receiptRouter from "../routes/communication-receipts";

const suite=process.env.RUN_NOTIFICATION_POSTGRES_TESTS==="1" ? describe : describe.skip;
suite("notification integration against disposable PostgreSQL",()=>{
  const m:any={nonce:`notification-native-${Date.now()}`,label:`NOTIFICATION NATIVE QA ${Date.now()}`,ids:{},fixtureIdentities:
    ["parent1","student1","parent2","teacher","schoolAdmin","accountant","partner"].map(role=>({
      role,email:`${role}-${Date.now()}@example.com`,clerkUserId:`user_native_notification_${role}_${Date.now()}`,firstName:"Native",lastName:role,
    }))};
  const user=(role:string)=>m.fixtureIdentities.find((u:any)=>u.role===role).appUserId;
  const subscription=(name:string, expirationTime:number|null=null)=>({endpoint:`https://fcm.googleapis.com/fcm/send/${name}`,expirationTime,
    keys:{p256dh:Buffer.from("046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5","hex").toString("base64url"),auth:Buffer.alloc(16,1).toString("base64url")}});
  const input=()=>({schoolId:m.ids.schoolId,recipientUserId:user("parent1"),subjectStudentId:m.ids.student1Id,
    category:"ANNOUNCEMENT" as const,eventKey:"event-1",subject:"Native test",body:"Safe notification",link:"/notifications",
    channels:["IN_APP","SMS","EMAIL","PUSH"] as ("IN_APP"|"SMS"|"EMAIL"|"PUSH")[]});
  const providers=():CommunicationProviderAdapters=>({sms:new MockSmsProvider(),email:new MockEmailProvider(),push:new MockPushProvider()});
  const dispatch=(p=providers())=>dispatchCommunicationDeliveries(pool,50,{providers:p,pushSessionActive:async()=>true});
  async function device(owner=user("parent1"),school=m.ids.schoolId,expires:number|null=null){
    const result=await pool.query(`INSERT INTO communication_push_devices(user_id,school_id,opaque_device_reference,subscription,session_id)
      VALUES($1,$2,$3,$4::jsonb,'sess_native') RETURNING id`,[owner,school,`test-${Math.random()}`,JSON.stringify(subscription(`test-${Math.random()}`,expires))]);
    return Number(result.rows[0].id);
  }
  beforeAll(async()=>{
    const r=(await pool.query("SELECT current_setting('data_directory') dir,inet_server_addr() host")).rows[0];
    if(r.dir!=="/tmp/educore-notification-postgres"||r.host!==null)throw Error("Disposable database only");
    // Dedicated disposable cluster only; no real data was copied into this schema clone.
    const schema=(await readFile("/tmp/educore-notification-schema.sql","utf8"))
      .split("\n").filter(line=>!line.startsWith("\\restrict")&&!line.startsWith("\\unrestrict")).join("\n");
    await pool.query("DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public");
    await pool.query(schema);
    await pool.query("SET search_path TO public");
    await pool.query(await readFile("../../lib/db/drizzle/0048_communication_external_channels.sql","utf8"));
    const c=await pool.connect();try{await c.query("BEGIN");await createSchoolRows(c,m,false);await c.query("COMMIT");}finally{c.release();}
  });
  beforeEach(async()=>{
    await pool.query("DELETE FROM communication_notifications WHERE school_id=$1",[m.ids.schoolId]);
    await pool.query("DELETE FROM communication_preferences WHERE user_id=ANY($1)",[m.fixtureIdentities.map((u:any)=>u.appUserId)]);
    await pool.query("DELETE FROM communication_push_devices WHERE user_id=ANY($1)",[m.fixtureIdentities.map((u:any)=>u.appUserId)]);
    await pool.query("UPDATE schools SET communication_defaults='{}' WHERE id=$1",[m.ids.schoolId]);
  });
  afterAll(async()=>{await pool.end();});
  it("one event queues once and fanout sends once per device/channel",async()=>{
    await device();await device();const p=providers();
    await queueCommunicationNotification(pool,input());await queueCommunicationNotification(pool,input());
    expect((await dispatch(p)).simulated).toBe(3);
    expect((await dispatch(p)).claimed).toBe(0);
    expect((p.sms as MockSmsProvider).attempts).toHaveLength(1);
    expect((p.email as MockEmailProvider).attempts).toHaveLength(1);
    expect((p.push as MockPushProvider).attempts).toHaveLength(2);
    const rows=(await pool.query("SELECT status,delivered_at,error_code FROM communication_deliveries")).rows;
    expect(rows).toHaveLength(4);expect(rows.every(r=>r.status==="SENT"&&r.delivered_at===null)).toBe(true);
  });
  it.each(["SMS","EMAIL","PUSH"])("disabled %s keeps other channels and inbox",async channel=>{
    await pool.query("INSERT INTO communication_preferences(user_id,school_id,category,channel,enabled) VALUES($1,$2,'ANNOUNCEMENT',$3,false)",
      [user("parent1"),m.ids.schoolId,channel]);
    await queueCommunicationNotification(pool,input());
    const rows=(await pool.query("SELECT channel FROM communication_deliveries")).rows.map(r=>r.channel);
    expect(rows).not.toContain(channel);expect(rows).toContain("IN_APP");expect(rows).toHaveLength(3);
  });
  it("mandatory security ignores disabled channel preferences",async()=>{
    for(const channel of ["SMS","EMAIL","PUSH"])await pool.query("INSERT INTO communication_preferences(user_id,school_id,category,channel,enabled) VALUES($1,$2,'SECURITY',$3,false)",[user("parent1"),m.ids.schoolId,channel]);
    await queueCommunicationNotification(pool,{...input(),category:"SECURITY"});
    expect((await pool.query("SELECT id FROM communication_deliveries")).rows).toHaveLength(4);
  });
  it("category defaults extend existing domain events rather than creating another event",async()=>{
    await pool.query(`UPDATE schools SET communication_defaults='{"ATTENDANCE":["PUSH","SMS","EMAIL"]}' WHERE id=$1`,[m.ids.schoolId]);
    const event={schoolId:m.ids.schoolId,studentId:m.ids.student1Id,eventType:"ATTENDANCE",eventId:"event",category:"ATTENDANCE" as const,subject:"Attendance update",body:"Attendance updated"};
    await emitDomainParentEvent(pool,event);await emitDomainParentEvent(pool,event);
    expect((await pool.query("SELECT id FROM communication_notifications")).rows).toHaveLength(1);
    expect((await pool.query("SELECT id FROM communication_deliveries")).rows).toHaveLength(4);
  });
  it.each([["NFC_SECURITY","SECURITY"],["ATTENDANCE","ATTENDANCE"],["RESULT_PUBLICATION","ACADEMIC"],
    ["FEE_INVOICE","FINANCE"],["ADMISSION_UPDATE","SYSTEM"],["BEHAVIOUR","SYSTEM"],["WELFARE","SYSTEM"]])("existing %s parent event retains in-app on external failure",async (eventType,category)=>{
    await emitDomainParentEvent(pool,{schoolId:m.ids.schoolId,studentId:m.ids.student1Id,eventType,eventId:"event",category:category as any,subject:"Update",body:"Open app",channels:["IN_APP","SMS","EMAIL"]});
    await dispatch({sms:new MockSmsProvider(["failure"]),email:new MockEmailProvider(["failure"])});
    const rows=(await pool.query("SELECT channel,status FROM communication_deliveries")).rows;
    expect(rows.find(r=>r.channel==="IN_APP")?.status).toBe("SENT");expect(rows.filter(r=>r.status==="FAILED")).toHaveLength(2);
  });
  it("accepted device is never resent when another device safely retries",async()=>{
    const a=await device(),b=await device();const attempts:string[]=[];
    const p=providers();p.push={provider:"mock-push",channel:"push",send:async message=>{
      attempts.push(message.idempotencyKey);const retry=message.idempotencyKey.endsWith(`-${b}`)&&attempts.length===2;
      return {provider:"mock-push",channel:"push",status:retry?"FAILED":"ACCEPTED",accepted:!retry,delivered:false,
        ...(retry?{failure:{category:"RATE_LIMITED",retryable:true}}:{} )};
    }};
    await queueCommunicationNotification(pool,input());await dispatch(p);
    await pool.query("UPDATE communication_deliveries SET next_attempt_at=NOW() WHERE channel='PUSH'");await dispatch(p);
    expect(attempts.filter(k=>k.endsWith(`-${a}`))).toHaveLength(1);
    expect(attempts.filter(k=>k.endsWith(`-${b}`))).toHaveLength(2);
  });
  it("ambiguous push is held, not retried",async()=>{
    await device();const send=vi.fn(async()=>({provider:"mock-push",channel:"push" as const,status:"FAILED" as const,accepted:false,delivered:false,failure:{category:"NETWORK" as const,retryable:true}}));
    const p=providers();p.push={provider:"mock-push",channel:"push",send};
    await queueCommunicationNotification(pool,input());await dispatch(p);
    await pool.query("UPDATE communication_deliveries SET next_attempt_at=NOW()");await dispatch(p);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT error_code FROM communication_deliveries WHERE channel='PUSH'")).rows[0].error_code).toBe("PROVIDER_OUTCOME_UNKNOWN");
  });
  it("expired subscriptions are revoked and never reach transport",async()=>{
    const id=await device(undefined,undefined,1),transport=vi.fn();
    const p=providers();p.push=new WebPushProvider({publicKey:"mock",privateKey:"mock",subject:"mailto:x@example.com"},transport);
    await queueCommunicationNotification(pool,input());await dispatch(p);
    expect(transport).not.toHaveBeenCalled();
    expect((await pool.query("SELECT status FROM communication_push_devices WHERE id=$1",[id])).rows[0].status).toBe("REVOKED");
  });
  it("invalidated sessions fail closed while preserving inbox",async()=>{
    const id=await device();const p=providers();await queueCommunicationNotification(pool,input());
    await dispatchCommunicationDeliveries(pool,50,{providers:p,pushSessionActive:async()=>false});
    expect((p.push as MockPushProvider).attempts).toHaveLength(0);
    expect((await pool.query("SELECT status FROM communication_push_devices WHERE id=$1",[id])).rows[0].status).toBe("REVOKED");
  });
  it("push never uses another parent's device",async()=>{
    await device();await device(user("parent2"));const p=providers();await queueCommunicationNotification(pool,input());await dispatch(p);
    expect((p.push as MockPushProvider).attempts).toHaveLength(1);
    expect(await queueCommunicationNotification(pool,{...input(),recipientUserId:user("parent2")})).toBeNull();
  });
  it("school A sends cannot use same user's school B device or authorize school B",async()=>{
    const b=(await pool.query("INSERT INTO schools(code,name,city,state,status) VALUES($1,'Native school B','TEST','TEST','active') RETURNING id",
      [`notification-b-${Date.now()}`])).rows[0].id;
    await device();await device(user("parent1"),b);
    const p=providers();await queueCommunicationNotification(pool,input());await dispatch(p);
    expect((p.push as MockPushProvider).attempts).toHaveLength(1);
    expect(await queueCommunicationNotification(pool,{...input(),schoolId:b,subjectStudentId:null})).toBeNull();
  });
  it("two child inbox contexts produce one campaign external send per channel",async()=>{
    await device();const p=providers();
    for(const student of [m.ids.student1Id,m.ids.student3Id])
      await queueCommunicationNotification(pool,{...input(),subjectStudentId:student,eventKey:`COMMUNICATION_CAMPAIGN:123:${user("parent1")}:STUDENT:${student}:CLASS:1`});
    await dispatch(p);
    expect((await pool.query("SELECT id FROM communication_notifications")).rows).toHaveLength(2);
    expect((p.sms as MockSmsProvider).attempts).toHaveLength(1);expect((p.email as MockEmailProvider).attempts).toHaveLength(1);
    expect((p.push as MockPushProvider).attempts).toHaveLength(1);
  });
  it("signed receipt replay is idempotent and forged school/recipient cannot select another delivery",async()=>{
    const own=await queueCommunicationNotification(pool,{...input(),channels:["IN_APP","EMAIL"]});
    const other=await queueCommunicationNotification(pool,{...input(),eventKey:"other",recipientUserId:user("parent2"),subjectStudentId:m.ids.student2Id,channels:["IN_APP","EMAIL"]});
    await pool.query(`UPDATE communication_deliveries SET status='SENT',provider_name='resend',
      provider_message_id='mock-own-email',provider_acknowledged_at=NOW(),sent_at=NOW()
      WHERE notification_id=$1 AND channel='EMAIL'`,[own]);
    const secret=Buffer.from("native-mock-signing").toString("base64");
    vi.stubEnv("RESEND_WEBHOOK_SECRET",`whsec_${secret}`);
    const app=express();app.use(express.raw({type:"application/json"}),receiptRouter);
    const server=app.listen(0,"127.0.0.1");
    await new Promise<void>(resolve=>server.once("listening",()=>resolve()));
    try{
      const port=(server.address() as {port:number}).port;
      const body=JSON.stringify({type:"email.delivered",data:{email_id:"mock-own-email"},schoolId:999999,recipientUserId:user("parent2")});
      const time=String(Math.floor(Date.now()/1000));
      const signature=createHmac("sha256",Buffer.from(secret,"base64")).update(`native-event.${time}.${body}`).digest("base64");
      const headers={"content-type":"application/json","svix-id":"native-event","svix-timestamp":time,"svix-signature":`v1,${signature}`};
      for(let n=0;n<2;n++)expect((await fetch(`http://127.0.0.1:${port}/resend`,{method:"POST",headers,body})).status).toBe(204);
      expect((await fetch(`http://127.0.0.1:${port}/resend`,{method:"POST",headers,body:"{}"})).status).toBe(401);
      const row=(await pool.query("SELECT status,receipt_ids,delivered_at FROM communication_deliveries WHERE notification_id=$1 AND channel='EMAIL'",[own])).rows[0];
      expect(row.status).toBe("DELIVERED");expect(row.receipt_ids).toEqual(["native-event"]);expect(row.delivered_at).toBeTruthy();
      expect((await pool.query("SELECT status FROM communication_deliveries WHERE notification_id=$1 AND channel='EMAIL'",[other])).rows[0].status).toBe("QUEUED");
    }finally{vi.unstubAllEnvs();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});