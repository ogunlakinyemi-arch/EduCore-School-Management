import express from "express";
import type { Server } from "node:http";
import { beforeAll,beforeEach,afterAll,describe,it,expect,vi } from "vitest";
import { lstatSync,realpathSync } from "node:fs";
import { createHash } from "node:crypto";

const state = vi.hoisted(() => ({
  subject:"fictional_subject",session:"old",email:"partner@fictional.invalid",verified:true,
  times:{} as Record<string,number>,
}));
const enabled = Boolean(process.env.REAPPLICATION_TEST_SOCKET);
vi.mock("@workspace/db", async () => {
  const socket = process.env.REAPPLICATION_TEST_SOCKET ?? "/tmp/never-connect";
  if (process.env.REAPPLICATION_TEST_SOCKET) {
    if (!/^\/tmp\/educore-partner-reapplication\.[A-Za-z0-9]+\/socket$/.test(socket)) throw Error("FRESH_PRIVATE_FIXTURE_REQUIRED");
    const st=lstatSync(socket);
    if (st.uid!==process.getuid?.() || (st.mode&0o077)!==0 || realpathSync(socket)!==socket) throw Error("PRIVATE_FIXTURE_REQUIRED");
  }
  const { DatabasePool } = await import("@workspace/db/driver");
  return { pool:new DatabasePool({ host:socket,port:55484,database:"postgres",user:"reapplication_admin",
    password:()=>"",ssl:false,connectionTimeoutMillis:3000 }) };
});
vi.mock("@clerk/express",()=>({
  getAuth:()=>({userId:state.subject,sessionId:state.session,iat:Date.now()}),
  clerkClient:{
    users:{getUser:vi.fn(async()=>({ id:state.subject,primaryEmailAddressId:"primary",
      emailAddresses:[{id:"primary",emailAddress:state.email,verification:{status:state.verified?"verified":"unverified"}}] }))},
    sessions:{getSession:vi.fn(async(id:string)=>({id,userId:state.subject,status:"active",createdAt:state.times[id]}))},
  },
}));

import { pool } from "@workspace/db";
import router from "./account-applications";
import { requireAuthentication,getUserContext } from "../middlewares/auth";
import { decideApplication } from "../services/account-applications";
import { prepareAccessArchive,applyAccessArchive } from "../../../../scripts/src/production-reset/access-archive.mjs";
import { assertTestArchiveAccess } from "../services/test-account-archive-access";

describe.skipIf(!enabled)("same-email reapplication on owned socket-only PostgreSQL",()=>{
  let server:Server,url:string,ownerId:number,oldId:number,oldProfile:number,oldApp:number,oldStudent:number;
  let original:any,batchId:string;
  const payload=()=>({applicantType:"PARTNER",partnerType:"INDIVIDUAL",fullName:"New Fictional Partner",
    email:state.email,phone:"+2348012345678",city:"Test",state:"Test"});
  const call=async(path:string,body?:unknown)=>fetch(`${url}${path}`,{
    method:body?"POST":"GET",headers:{"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  const owner=()=>({user:{id:ownerId,clerkUserId:"owner_subject",email:"owner@fictional.invalid",
    firstName:"Owner",lastName:"Fixture",phone:null,status:"ACTIVE" as const},
    roles:[{id:1,role:"PLATFORM_OWNER" as const,schoolId:null,status:"ACTIVE" as const}]});
  const preserved=async()=>({
    user:(await pool.query("SELECT to_jsonb(u) AS r FROM app_users u WHERE id=$1",[oldId])).rows,
    profile:(await pool.query("SELECT to_jsonb(p) AS r FROM partner_profiles p WHERE id=$1",[oldProfile])).rows,
    application:(await pool.query("SELECT to_jsonb(a) AS r FROM account_applications a WHERE id=$1",[oldApp])).rows,
    memberships:(await pool.query("SELECT to_jsonb(m) AS r FROM school_memberships m WHERE user_id=$1 ORDER BY id",[oldId])).rows,
    histories:(await pool.query(`SELECT to_jsonb(p) AS r FROM fee_payments p
      UNION ALL SELECT to_jsonb(c) FROM nfc_cards c
      UNION ALL SELECT to_jsonb(d) FROM device_assignment_history d`)).rows,
    invitations:(await pool.query("SELECT to_jsonb(i) AS r FROM partner_invitations i")).rows,
  });
  beforeAll(async()=>{
    const identity=(await pool.query(`SELECT current_setting('data_directory') AS data,
      current_user AS role,inet_server_addr() AS addr,current_setting('listen_addresses') AS listeners`)).rows[0];
    expect(identity).toEqual({data:process.env.REAPPLICATION_TEST_DATA,role:"reapplication_admin",addr:null,listeners:""});
    const app=express();app.use(express.json());app.use(router);
    app.get("/protected",requireAuthentication(),(req,res)=>res.json(getUserContext(req)));
    await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>resolve())});
    url=`http://127.0.0.1:${(server.address() as any).port}`;
  });
  beforeEach(async()=>{
    // ONLY fictional data in this independently verified, fresh local cluster.
    await pool.query("TRUNCATE app_users,schools RESTART IDENTITY CASCADE");
    state.subject="fictional_subject";state.session="old";state.email="partner@fictional.invalid";state.verified=true;
    ownerId=(await pool.query(`INSERT INTO app_users(clerk_user_id,email) VALUES('owner_subject','owner@fictional.invalid') RETURNING id`)).rows[0].id;
    oldId=(await pool.query("INSERT INTO app_users(clerk_user_id,email) VALUES($1,$2) RETURNING id",[state.subject,state.email])).rows[0].id;
    await pool.query("INSERT INTO schools(id,code,name) VALUES(9,'FIXTURE','Fictional school')");
    await pool.query(`INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,NULL,'PLATFORM_OWNER'),
      ($2,NULL,'PARTNER'),($2,9,'SCHOOL_ADMIN')`,[ownerId,oldId]);
    oldStudent=(await pool.query("INSERT INTO students(school_id) VALUES(9) RETURNING id")).rows[0].id;
    oldProfile=(await pool.query(`INSERT INTO partner_profiles(user_id,partner_code,email,full_name,type,created_by)
      VALUES($1,'OLD-PARTNER',$2,'Old historical partner','INDIVIDUAL',$3) RETURNING id`,[oldId,state.email,ownerId])).rows[0].id;
    await pool.query("INSERT INTO partner_profile_users VALUES($1,$2,'PARTNER','ACTIVE')",[oldProfile,oldId]);
    await pool.query("INSERT INTO partner_invitations(partner_profile_id,invited_email,status,token_hash) VALUES($1,$2,'ACTIVE','old-token')",[oldProfile,state.email]);
    oldApp=(await pool.query(`INSERT INTO account_applications
      (user_id,applicant_type,partner_type,first_name,last_name,email,phone,city,state,status,reviewed_at,reviewed_by,partner_profile_id)
      VALUES($1,'PARTNER','INDIVIDUAL','Old','Partner',$2,'+2348012345678','','','APPROVED',NOW(),$3,$4) RETURNING id`,
    [oldId,state.email,ownerId,oldProfile])).rows[0].id;
    await pool.query("INSERT INTO fee_payments(school_id,student_id,partner_profile_id,recorded_by,amount) VALUES(9,$1,$2,$3,1900)",[oldStudent,oldProfile,oldId]);
    await pool.query("INSERT INTO nfc_cards(school_id,student_id,uid) VALUES(9,$1,'old-history')",[oldStudent]);
    const device=(await pool.query("INSERT INTO platform_devices(school_id) VALUES(9) RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO device_assignment_history(device_id,school_id) VALUES($1,9)",[device]);
    batchId=createHash("sha256").update("fictional block").digest("hex");
    const plan=await prepareAccessArchive(pool,{schoolIds:[9],partnerIds:[oldProfile]});
    const c=await pool.connect();
    try {await c.query("BEGIN");await applyAccessArchive(c,{plan,actorUserId:ownerId,batchId});await c.query("COMMIT")}finally{c.release()}
    state.times={old:Date.now()-60_000,fresh:Date.now()+10,later:Date.now()+10_000};
    original=await preserved();
  });
  afterAll(async()=>{if(server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}await pool.end()});
  const reapply=async()=>{
    state.session="fresh";
    const response=await call("/account-application/partner-reapplication",payload());
    expect(response.status,await response.clone().text()).toBe(201);
    return await response.json() as any;
  };
  const newUser=async()=>Number((await pool.query("SELECT new_user_id FROM partner_account_reapplications ORDER BY id DESC LIMIT 1")).rows[0].new_user_id);

  it("creates a new pending internal identity with the SAME email, not another Clerk identity or old binding",async()=>{
    const a=await reapply(),id=await newUser();
    expect(id).not.toBe(oldId);expect(a.id).not.toBe(oldApp);expect(a.status).toBe("PENDING");
    expect((await pool.query("SELECT clerk_user_id,email FROM app_users WHERE id=$1",[id])).rows[0]).toEqual({clerk_user_id:null,email:state.email});
    expect(await preserved()).toEqual(original);
    for(const table of ["school_memberships","partner_profiles","partner_profile_users","students","parents","employees"]){
      expect((await pool.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[id])).rows).toHaveLength(0);
    }
    const mine=await call("/account-application");
    expect(mine.status).toBe(200);expect((await mine.json() as any).application.id).toBe(a.id);
    expect((await call("/protected")).status).toBe(403); // Owner approval still required.
  });
  it("denies old sessions/refreshed tokens before AND after the same-email application",async()=>{
    expect((await call("/protected")).status).toBe(403);
    const before=await call("/account-application/partner-reapplication",payload());
    expect(before.status).toBe(403);expect((await before.json() as any).code).toBe("REAPPLICATION_FRESH_SIGN_IN_REQUIRED");
    await reapply();state.session="old";
    expect((await call("/protected")).status).toBe(403);
    const retry=await call("/account-application/partner-reapplication",payload());
    expect(retry.status).toBe(409); // Active fresh application also prevents a duplicate.
    expect((await pool.query("SELECT count(*)::int AS n FROM partner_account_reapplications")).rows[0].n).toBe(1);
  });
  it("approval creates ONLY a fresh Partner role/profile with no inherited school/invitation/history access",async()=>{
    const a=await reapply();await decideApplication(owner(),a.id,{status:"APPROVED"});
    const r=await call("/protected");expect(r.status).toBe(200);
    const ctx=await r.json() as any;expect(ctx.user.id).toBe(await newUser());
    expect(ctx.roles.map((x:any)=>[x.role,x.schoolId])).toEqual([["PARTNER",null]]);
    const p=(await pool.query("SELECT id FROM partner_profiles WHERE user_id=$1",[ctx.user.id])).rows[0];
    expect(p.id).not.toBe(oldProfile);expect(await preserved()).toEqual(original);
    await expect(assertTestArchiveAccess({userId:ctx.user.id,partnerId:oldProfile})).rejects.toMatchObject({statusCode:403});
    state.session="old";expect((await call("/protected")).status).toBe(403);
  });
  it("keeps active-account duplicate protection and rejects a second fresh-session application",async()=>{
    await reapply();state.session="later";
    expect((await call("/account-application/partner-reapplication",payload())).status).toBe(409);
  });
  it("rejects an unrelated active account using the same email without creating any new identity",async()=>{
    await pool.query("INSERT INTO app_users(clerk_user_id,email) VALUES('active_other',$1)",[state.email]);
    state.session="fresh";
    expect((await call("/account-application/partner-reapplication",payload())).status).toBe(409);
    expect((await pool.query("SELECT count(*)::int AS n FROM partner_account_reapplications")).rows[0].n).toBe(0);
  });
  it("recovers the identical pending request after a lost response, but does not resubmit changed data",async()=>{
    const a=await reapply();const retry=await call("/account-application/partner-reapplication",payload());
    expect(retry.status).toBe(201);expect((await retry.json() as any).id).toBe(a.id);
    expect((await call("/account-application/partner-reapplication",{...payload(),fullName:"Different request"})).status).toBe(409);
    expect((await pool.query("SELECT count(*)::int AS n FROM partner_account_reapplications")).rows[0].n).toBe(1);
  });
  it("accepts later genuinely new sessions only for the fresh account, never for the archived identity",async()=>{
    const a=await reapply();await decideApplication(owner(),a.id,{status:"APPROVED"});
    state.session="later";const r=await call("/protected");
    expect(r.status).toBe(200);expect((await r.json() as any).user.id).toBe(await newUser());
    state.session="old";expect((await call("/protected")).status).toBe(403);
  });
  it("does not emit RESTORE; only a separate Owner restoration can reopen the original account",async()=>{
    const a=await reapply();await decideApplication(owner(),a.id,{status:"APPROVED"});
    expect((await pool.query("SELECT 1 FROM audit_logs WHERE metadata->>'operation'='RESTORE'")).rows).toHaveLength(0);
    state.session="old";expect((await call("/protected")).status).toBe(403);
    const c=await pool.connect();
    try{await c.query("BEGIN");await applyAccessArchive(c,{actorUserId:ownerId,batchId,restore:true});await c.query("COMMIT")}finally{c.release()}
    const old=await call("/protected");expect(old.status).toBe(200);expect((await old.json() as any).user.id).toBe(oldId);
    state.session="fresh";const fresh=await call("/protected");
    expect((await fresh.json() as any).user.id).toBe(await newUser());
    expect(await preserved()).toEqual(original);
  });
  it("can archive and restore the NEW profile independently even though its email matches the OLD archive",async()=>{
    const a=await reapply();await decideApplication(owner(),a.id,{status:"APPROVED"});
    const id=await newUser();
    const p=(await pool.query("SELECT id FROM partner_profiles WHERE user_id=$1",[id])).rows[0].id;
    const plan=await prepareAccessArchive(pool,{schoolIds:[],partnerIds:[p]});
    expect(plan.userIds).toEqual([id]);
    const nextBatch=createHash("sha256").update("independent new account").digest("hex");
    const c=await pool.connect();
    try{
      await c.query("BEGIN");await applyAccessArchive(c,{plan,actorUserId:ownerId,batchId:nextBatch});await c.query("COMMIT");
      expect((await call("/protected")).status).toBe(403);
      // Replaying the original POST must not expose/reopen the newly archived account.
      expect((await call("/account-application/partner-reapplication",payload())).status).toBe(403);
      await c.query("BEGIN");await applyAccessArchive(c,{actorUserId:ownerId,batchId:nextBatch,restore:true});await c.query("COMMIT");
    }finally{c.release()}
    expect((await call("/protected")).status).toBe(200);
    state.session="old";expect((await call("/protected")).status).toBe(403);
    expect(await preserved()).toEqual(original);
  });
  it("requires verified primary email and Partner-only input; does not bypass active-account checks",async()=>{
    state.session="fresh";state.verified=false;
    expect((await call("/account-application/partner-reapplication",payload())).status).toBe(403);
    state.verified=true;
    expect((await call("/account-application/partner-reapplication",{...payload(),applicantType:"SCHOOL_ADMIN",schoolName:"Wrong"})).status).toBe(400);
    expect((await pool.query("SELECT count(*)::int AS n FROM partner_account_reapplications")).rows[0].n).toBe(0);
  });
  it("permits another fresh generation after the new profile is archived, without consuming its new sign-in session",async()=>{
    const a=await reapply();await decideApplication(owner(),a.id,{status:"APPROVED"});
    const firstNew=await newUser();
    const profile=(await pool.query("SELECT id FROM partner_profiles WHERE user_id=$1",[firstNew])).rows[0].id;
    const plan=await prepareAccessArchive(pool,{schoolIds:[],partnerIds:[profile]});
    const c=await pool.connect();
    try{
      await c.query("BEGIN");
      await applyAccessArchive(c,{plan,actorUserId:ownerId,batchId:createHash("sha256").update("later archive").digest("hex")});
      await c.query("COMMIT");
    }finally{c.release()}
    state.session="newest";state.times.newest=Date.now()+20_000;
    expect((await call("/account-application")).status).toBe(403);
    expect((await pool.query("SELECT 1 FROM partner_reapplication_sessions WHERE session_id='newest'")).rows).toHaveLength(0);
    const again=await call("/account-application/partner-reapplication",payload());
    expect(again.status,await again.clone().text()).toBe(201);
    const secondNew=await newUser();expect(secondNew).not.toBe(firstNew);expect(secondNew).not.toBe(oldId);
    expect((await pool.query("SELECT 1 FROM school_memberships WHERE user_id=$1",[secondNew])).rows).toHaveLength(0);
    state.session="fresh";expect((await call("/protected")).status).toBe(403);
    state.session="old";expect((await call("/protected")).status).toBe(403);
    expect(await preserved()).toEqual(original);
  });
});
