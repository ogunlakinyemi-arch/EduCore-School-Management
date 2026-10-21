import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {execFileSync,spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import express from "express";
import {DatabasePool} from "@workspace/db/driver";
import {refreshTelegramHealth,getTelegramHealth,createTelegramProvider} from "./telegram-provider";
import {createParentTelegramChallenge,acceptTelegramUpdate,confirmParentTelegramLink,telegramRecipient,
  revokeParentTelegramLink,sealTelegramChat,openTelegramChat} from "./telegram-links";
import {dispatchCommunicationDeliveries,queueCommunicationNotification} from "./communication-service";

const state=vi.hoisted(()=>({pool:null as any,userId:1,role:"PARENT",anonymous:false}));
vi.mock("@workspace/db",async original=>({...await original<any>(),pool:{
  query:(...args:any[])=>state.pool.query(...args),connect:()=>state.pool.connect()}}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=> (_req:any,res:any,next:any)=>state.anonymous?res.status(401).json({error:"Sign in"}):next(),
    getUserContext:()=>({user:{id:state.userId,email:"fixture@example.invalid"},roles:[{role:state.role,
      status:"ACTIVE",schoolId:state.role==="PLATFORM_OWNER"?null:state.userId}]})};
});
import telegramRouter from "../routes/telegram";
const fixtureEnv={NODE_ENV:"test",TELEGRAM_BOT_TOKEN:"123456:fixture_telegram_token_not_real",SESSION_SECRET:"fixture-only-telegram-encryption-key-0123456789"};
const botFetch=vi.fn(async (_url:any,options:any)=>{
  const method=String(_url).split("/").at(-1);
  return new Response(JSON.stringify({ok:true,result:method==="getMe"?{id:123456,is_bot:true,username:"EduCoreFixtureBot"}
    :method==="getWebhookInfo"?{url:""}:{message_id:71}}),{status:200});
});
let dir:string,postgres:ChildProcess,db:any;
let server:any,base:string;
const nativeFetch=fetch;
beforeAll(async()=>{
  for(const [key,value]of Object.entries(fixtureEnv))vi.stubEnv(key,value);
  dir=await mkdtemp(path.join(tmpdir(),"telegram-test-"));
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:"C.UTF-8"};
  execFileSync("initdb",["-D",path.join(dir,"data"),"-U","telegram_fixture","-A","trust","--no-locale"],{env,stdio:"ignore"});
  postgres=spawn("postgres",["-D",path.join(dir,"data"),"-k",dir,"-h","","-p","5432"],{env,stdio:"ignore"});
  db=state.pool=new DatabasePool({host:dir,port:5432,user:"telegram_fixture",database:"postgres",connectionTimeoutMillis:500,max:3});
  let ready=false;for(let i=0;i<100;i++){try{await db.query("SELECT 1");ready=true;break;}catch{await new Promise(r=>setTimeout(r,30));}}
  if(!ready)throw new Error("Disposable database unavailable; application fallback prohibited");
  await db.query(`CREATE TABLE schools(id int PRIMARY KEY,name text,status text,communication_defaults jsonb DEFAULT '{}');
    CREATE TABLE app_users(id int PRIMARY KEY,email text,phone text,status text);
    CREATE TABLE school_memberships(user_id int,school_id int,role text,status text);
    CREATE TABLE students(id int PRIMARY KEY,user_id int,school_id int,status text,class_name text,section text);
    CREATE TABLE parents(id int PRIMARY KEY,user_id int,school_id int,status text,phone text);
    CREATE TABLE parent_student_relationships(parent_id int,student_id int,status text);
    CREATE TABLE school_classes(id int PRIMARY KEY,school_id int,name text,section text);
    CREATE TABLE audit_logs(id serial PRIMARY KEY,actor_user_id int,"user" text,role text,school_id int,
      action text,module text,event_type text,result text,metadata jsonb);
    CREATE TABLE communication_notifications(id serial PRIMARY KEY,recipient_user_id int,school_id int,
      subject_student_id int,subject_class_id int,category text,event_key text,subject text,body text,link text,created_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX notification_events ON communication_notifications(school_id,event_key,recipient_user_id)
      WHERE school_id IS NOT NULL AND event_key IS NOT NULL;
    CREATE TABLE communication_deliveries(id serial PRIMARY KEY,notification_id int,channel text,status text DEFAULT 'QUEUED',
      attempts int DEFAULT 0,next_attempt_at timestamptz DEFAULT now(),last_attempt_at timestamptz,updated_at timestamptz DEFAULT now(),
      created_at timestamptz DEFAULT now(),provider_message_id text,provider_name text,provider_acknowledged_at timestamptz,
      sent_at timestamptz,delivered_at timestamptz,failed_at timestamptz,error_code text,last_error text,
      UNIQUE(notification_id,channel),CONSTRAINT communication_deliveries_channel_check CHECK(channel IN ('IN_APP','SMS','EMAIL','PUSH')));
    CREATE TABLE communication_preferences(user_id int,school_id int,category text,channel text,enabled boolean,
      CONSTRAINT communication_preferences_channel_check CHECK(channel IN ('IN_APP','SMS','EMAIL','PUSH')));
    CREATE TABLE communication_templates(channel text,CONSTRAINT communication_templates_channel_check CHECK(channel IN ('IN_APP','SMS','EMAIL','PUSH')));`);
  await db.query(await readFile(new URL("../../../../lib/db/drizzle/0172_telegram_notifications.sql",import.meta.url),"utf8"));
  const app=express().use(express.json()).use("/communication/telegram",telegramRouter);
  app.use((e:any,_req:any,res:any,_next:any)=>res.status(e.statusCode??500).json({error:e.message}));
  await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>resolve());});
  base=`http://127.0.0.1:${server.address().port}`;
  vi.stubGlobal("fetch",((url:any,options:any)=>String(url).startsWith("https://api.telegram.org/")
    ?botFetch(url,options):nativeFetch(url,options)) as typeof fetch);
},30000);
afterAll(async()=>{
  if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));
  await db?.end();if(postgres?.exitCode===null){postgres.kill("SIGTERM");await new Promise<void>(r=>postgres.once("exit",()=>r()));}
  if(dir)await rm(dir,{recursive:true,force:true});vi.unstubAllEnvs();vi.unstubAllGlobals();
});
beforeEach(async()=>{
  state.userId=1;state.role="PARENT";state.anonymous=false;
  await db.query(`TRUNCATE telegram_link_challenges,parent_telegram_links,telegram_poll_state,
    schools,app_users,school_memberships,students,parents,parent_student_relationships,audit_logs,
    communication_notifications,communication_deliveries,communication_preferences RESTART IDENTITY CASCADE;
    INSERT INTO schools VALUES(1,'Fixture school','active','{"ATTENDANCE_ENTRY":["TELEGRAM"]}'),(2,'Other','active','{}');
    INSERT INTO app_users VALUES(1,'parent1@example.invalid',NULL,'ACTIVE'),(2,'parent2@example.invalid',NULL,'ACTIVE');
    INSERT INTO parents VALUES(1,1,1,'ACTIVE',NULL),(2,2,2,'ACTIVE',NULL);
    INSERT INTO students VALUES(1,NULL,1,'ACTIVE','A',''),(2,NULL,2,'ACTIVE','B','');
    INSERT INTO parent_student_relationships VALUES(1,1,'ACTIVE'),(2,2,'ACTIVE');
    INSERT INTO school_memberships VALUES(1,1,'PARENT','ACTIVE'),(2,2,'PARENT','ACTIVE');
    INSERT INTO audit_logs(role,module,event_type,result,metadata) VALUES('PLATFORM_OWNER','NotificationPolicy',
      'GLOBAL_CHANNEL_POLICY_UPDATED','SUCCESS','{"policy":{"events":{"ATTENDANCE_ENTRY":{"allowed":["IN_APP","TELEGRAM"],"defaults":["IN_APP"]}},"schools":{}}}');`);
  botFetch.mockClear();await refreshTelegramHealth(true,process.env,botFetch as any);botFetch.mockClear();
});
async function tx<T>(fn:(client:any)=>Promise<T>){const c=await db.connect();try{await c.query("BEGIN");
  const result=await fn(c);await c.query("COMMIT");return result;}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}
const tokenFrom=(url:string)=>new URL(url).searchParams.get("start")!;
const start=(token:string,chat=888001)=>({update_id:1,message:{chat:{id:chat,type:"private"},from:{id:chat,username:"FixtureParent"},text:`/start ${token}`}});
async function link(chat=888001){
  const challenge=await tx(c=>createParentTelegramChallenge(c,1,1));
  await tx(c=>acceptTelegramUpdate(c,start(tokenFrom(challenge.url),chat)));
  await tx(c=>confirmParentTelegramLink(c,1,1));return challenge;
}
async function notification(eventKey="PARENT_EVENT:SCHOOL_ENTRY:1:1:1",channel="TELEGRAM"){
  const n=(await db.query(`INSERT INTO communication_notifications(recipient_user_id,school_id,subject_student_id,category,event_key,subject,body)
    VALUES(1,1,1,'ATTENDANCE',$1,'Gate entry','Verified fixture attendance') RETURNING id`,[eventKey])).rows[0].id;
  await db.query("INSERT INTO communication_deliveries(notification_id,channel) VALUES($1,$2)",[n,channel]);return n;
}
const mocks=()=>({sms:{provider:"mock-sms",channel:"sms" as const,send:vi.fn()},email:{provider:"mock-email",channel:"email" as const,send:vi.fn()}});
describe("Telegram real SQL: linking, consent and outbox safety; no external network",()=>{
  it("encrypts authenticated-parent chat payloads with ownership-bound authenticated encryption",()=>{
    const sealed=sealTelegramChat(1,{chatId:"888001",label:"Fixture"},process.env);
    expect(sealed).not.toContain("888001");expect(openTelegramChat(1,sealed).chatId).toBe("888001");
    expect(()=>openTelegramChat(2,sealed)).toThrow();
    expect(()=>openTelegramChat(1,sealed.slice(0,-3)+"bad")).toThrow();
  });
  it("requires private-chat initiation and separate authenticated confirmation, storing only a token hash",async()=>{
    const challenge=await tx(c=>createParentTelegramChallenge(c,1,1)),token=tokenFrom(challenge.url);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row=(await db.query("SELECT * FROM telegram_link_challenges")).rows[0];expect(JSON.stringify(row)).not.toContain(token);
    await expect(tx(c=>confirmParentTelegramLink(c,1,1))).rejects.toThrow(/Start the bot/);
    const group=start(token);group.message.chat.type="group";expect(await tx(c=>acceptTelegramUpdate(c,group))).toBe(false);
    expect(await tx(c=>acceptTelegramUpdate(c,start(token)))).toBe(true);
    expect(await telegramRecipient(db,1,1,1,"ATTENDANCE")).toBe(null);
    await tx(c=>confirmParentTelegramLink(c,1,1));
    expect(await telegramRecipient(db,1,1,1,"ATTENDANCE")).toBe("888001");
    expect(botFetch).not.toHaveBeenCalled();
  });
  it("denies unrelated and foreign-school children at creation and delivery",async()=>{
    await expect(tx(c=>createParentTelegramChallenge(c,1,2))).rejects.toThrow(/relationship/);
    await link(888002);expect(await telegramRecipient(db,1,2,2,"ATTENDANCE")).toBe(null);
    expect(await telegramRecipient(db,2,1,1,"ATTENDANCE")).toBe(null);
    await db.query("UPDATE parent_student_relationships SET status='INACTIVE' WHERE parent_id=1");
    expect(await telegramRecipient(db,1,1,1,"ATTENDANCE")).toBe(null);
  });
  it("expires challenges, rejects replay and prevents another parent from confirming",async()=>{
    const c=await tx(c=>createParentTelegramChallenge(c,1,1)),token=tokenFrom(c.url);
    await tx(c=>acceptTelegramUpdate(c,start(token,888003)));
    expect(await tx(c=>acceptTelegramUpdate(c,start(token,888004)))).toBe(false);
    await expect(tx(c=>confirmParentTelegramLink(c,2,2))).rejects.toThrow();
    await db.query("UPDATE telegram_link_challenges SET created_at=now()-INTERVAL '20 minutes',expires_at=now()-INTERVAL '10 minutes'");
    await expect(tx(c=>confirmParentTelegramLink(c,1,1))).rejects.toThrow(/Start the bot/);
  });
  it("withdraws consent, erases chat ciphertext and cancels queued deliveries",async()=>{
    await link(888005);await notification();
    await tx(c=>revokeParentTelegramLink(c,1));
    expect(await telegramRecipient(db,1,1,1,"ATTENDANCE")).toBe(null);
    expect((await db.query("SELECT chat_ciphertext,chat_hash,consented_at FROM parent_telegram_links")).rows[0])
      .toEqual({chat_ciphertext:null,chat_hash:null,consented_at:null});
    expect((await db.query("SELECT status,error_code FROM communication_deliveries")).rows[0])
      .toMatchObject({status:"CANCELLED",error_code:"TELEGRAM_CONSENT_WITHDRAWN"});
  });
  it("honors bot /stop for pending links and rechecks changed category consent at dispatch",async()=>{
    const challenge=await tx(c=>createParentTelegramChallenge(c,1,1));
    await tx(c=>acceptTelegramUpdate(c,start(tokenFrom(challenge.url),888006)));
    const stop=start("",888006);stop.message.text="/stop";
    await tx(c=>acceptTelegramUpdate(c,stop));
    await expect(tx(c=>confirmParentTelegramLink(c,1,1))).rejects.toThrow();
    await link(888007);
    await db.query("INSERT INTO communication_preferences VALUES(1,1,'ATTENDANCE','TELEGRAM',false)");
    expect(await telegramRecipient(db,1,1,1,"ATTENDANCE")).toBe(null);
  });
  it("queues duplicate event identities only once and sends Telegram without claiming SMS",async()=>{
    await link(888008);
    const input={recipientUserId:1,schoolId:1,subjectStudentId:1,category:"ATTENDANCE" as const,
      eventKey:"PARENT_EVENT:SCHOOL_ENTRY:fixture:1:1",subject:"Entry",body:"Fixture",link:null,channels:["TELEGRAM" as const]};
    await queueCommunicationNotification(db,input);await queueCommunicationNotification(db,input);
    expect((await db.query("SELECT * FROM communication_deliveries WHERE channel='TELEGRAM'")).rows).toHaveLength(1);
    await notification("SMS_ONLY","SMS");
    const providers={...mocks(),telegram:createTelegramProvider(process.env,botFetch as any)!};
    const result=await dispatchCommunicationDeliveries(db,10,{providers,channels:["TELEGRAM"]});
    expect(result.accepted).toBe(1);expect(botFetch).toHaveBeenCalledTimes(1);
    await dispatchCommunicationDeliveries(db,10,{providers,channels:["TELEGRAM"]});expect(botFetch).toHaveBeenCalledTimes(1);
    expect((await db.query("SELECT status FROM communication_deliveries WHERE channel='SMS'")).rows[0].status).toBe("QUEUED");
    expect((await db.query("SELECT status,delivered_at,provider_message_id FROM communication_deliveries WHERE channel='TELEGRAM'")).rows[0])
      .toMatchObject({status:"SENT",delivered_at:null,provider_message_id:"71"});
  });
  it("holds uncertain provider acceptance instead of duplicating a send",async()=>{
    await link(888009);await notification();
    const send=vi.fn(async()=>{throw new Error("accepted then connection lost");});
    const providers={...mocks(),telegram:{provider:"fixture-telegram",channel:"telegram" as const,send}};
    await dispatchCommunicationDeliveries(db,10,{providers,channels:["TELEGRAM"]});
    await dispatchCommunicationDeliveries(db,10,{providers,channels:["TELEGRAM"]});
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.query("SELECT error_code FROM communication_deliveries")).rows[0].error_code).toBe("PROVIDER_OUTCOME_UNKNOWN");
  });
  it("honors Telegram retry_after and current Owner revocation before any send",async()=>{
    await link(888010);await notification();
    const send=vi.fn(async()=>({provider:"fixture",channel:"telegram" as const,status:"FAILED" as const,accepted:false,delivered:false,
      failure:{category:"RATE_LIMITED" as const,retryable:true,retryAfterSeconds:120}}));
    const now=new Date(Date.now()+1000);
    await dispatchCommunicationDeliveries(db,10,{providers:{...mocks(),telegram:{provider:"fixture",channel:"telegram",send}},channels:["TELEGRAM"],now:()=>now});
    const row=(await db.query("SELECT next_attempt_at FROM communication_deliveries")).rows[0];
    expect(new Date(row.next_attempt_at).getTime()-now.getTime()).toBe(120000);
    await db.query("UPDATE communication_deliveries SET next_attempt_at=now();DELETE FROM audit_logs");
    await dispatchCommunicationDeliveries(db,10,{providers:{...mocks(),telegram:{provider:"fixture",channel:"telegram",send}},channels:["TELEGRAM"]});
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.query("SELECT error_code FROM communication_deliveries")).rows[0].error_code).toBe("OWNER_CHANNEL_POLICY");
  });
  it("HTTP linking denies non-parents, anonymous requests, cross-origin requests and arbitrary chat IDs",async()=>{
    const request=(body:any,origin=base)=>fetch(`${base}/communication/telegram/link`,{method:"POST",
      headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify(body)});
    state.anonymous=true;expect((await request({schoolId:1,consent:true})).status).toBe(401);state.anonymous=false;
    state.role="TEACHER";expect((await request({schoolId:1,consent:true})).status).toBe(403);state.role="PARENT";
    expect((await request({schoolId:1,consent:true},"https://example.invalid")).status).toBe(403);
    expect((await request({schoolId:1,consent:false})).status).toBe(400);
    expect((await request({schoolId:1,consent:true,chatId:"arbitrary"})).status).toBe(400);
    expect((await db.query("SELECT * FROM telegram_link_challenges")).rows).toHaveLength(0);
    expect((await request({schoolId:1,consent:true})).status).toBe(200);
  });
  it("owner-only configuration test calls no send API and status exposes no chat/cipher/token",async()=>{
    expect((await fetch(`${base}/communication/telegram/health`,{method:"POST",headers:{Origin:base}})).status).toBe(403);
    state.role="PLATFORM_OWNER";
    const response=await fetch(`${base}/communication/telegram/health`,{method:"POST",headers:{Origin:base}});
    expect(response.status).toBe(200);
    const body=await response.json();expect(body).toMatchObject({configured:true,ready:true,reason:"READY"});
    expect(botFetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(body)).not.toMatch(/fixture_telegram_token_not_real|chat_ciphertext|chatId|tokenHash/);
    expect((await db.query("SELECT event_type FROM audit_logs WHERE event_type='TELEGRAM_CONFIGURATION_CHECK'")).rows).toHaveLength(1);
  });
});
