import express from "express";
import type {Server} from "node:http";
import {createHash,randomUUID} from "node:crypto";
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from "vitest";
const enabled=Boolean(process.env.INVITATION_TEST_SOCKET);
const state=vi.hoisted(()=>({
  ownerId:0,owner:true,partnerActor:false,partnerId:0,sourceId:0,email:"",
  mode:"success",create:vi.fn(),revoke:vi.fn(),
  invitations:[] as any[],
}));
vi.mock("@workspace/db",async()=>{
  const {DatabasePool}=await import("@workspace/db/driver");
  return {pool:new DatabasePool({host:process.env.INVITATION_TEST_SOCKET??"/tmp/never",port:55483,user:"postgres",database:"postgres"})};
});
vi.mock("@clerk/express",()=>({clerkClient:{
  users:{getUserList:vi.fn(async()=>({data:[],totalCount:0}))},
  invitations:{
    createInvitation:(input:any)=>state.create(input),
    revokeInvitation:(id:string)=>state.revoke(id),
    getInvitationList:vi.fn(async({status,query}:any)=>{
      const data=state.invitations.filter(i=>i.status===status&&i.emailAddress===query);
      return {data,totalCount:data.length};
    }),
  },
}}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=> (req:any,_res:any,next:()=>void)=>{
    req.edupulseUser={user:{id:state.ownerId,clerkUserId:"isolated_owner",email:"owner@example.test",status:"ACTIVE"},
      roles:[{id:1,role:state.partnerActor?"PARTNER":state.owner?"PLATFORM_OWNER":"SCHOOL_ADMIN",schoolId:state.owner||state.partnerActor?null:1,status:"ACTIVE"}]};
    next();
  }};
});
import {pool} from "@workspace/db";
import partners from "./partners";
describe.skipIf(!enabled)("Partner resend with real PostgreSQL and mocked Clerk",()=>{
  let server:Server,url:string;
  beforeAll(async()=>{
    const app=express();app.use(express.json());app.use(partners);
    app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
      res.status(err.statusCode??500).json({error:err.statusCode?err.message:"Internal server error",code:err.eventType});
    });
    await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>resolve())});
    url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  });
  beforeEach(async()=>{
    state.owner=true;state.partnerActor=false;state.mode="success";state.invitations=[];
    const actor=randomUUID();
    state.ownerId=(await pool.query(`INSERT INTO app_users(clerk_user_id,email) VALUES($1,$2) RETURNING id`,
      [`isolated_${actor}`,`owner-${actor}@example.test`])).rows[0].id;
    state.email=`resend-${randomUUID()}@example.test`;
    state.partnerId=(await pool.query(`INSERT INTO partner_profiles(partner_code,full_name,email,status,created_by)
      VALUES($1,'Isolated Partner',$2,'INVITED',$3) RETURNING id`,[randomUUID(),state.email,state.ownerId])).rows[0].id;
    state.sourceId=(await pool.query(`INSERT INTO partner_invitations(partner_profile_id,invited_email,token_hash,status,expires_at,created_by)
      VALUES($1,$2,$3,'ACTIVE',NOW()+INTERVAL '7 days',$4) RETURNING id`,
    [state.partnerId,state.email,createHash("sha256").update(randomUUID()).digest("hex"),state.ownerId])).rows[0].id;
    await pool.query(`INSERT INTO audit_logs("user",role,action,module,record_id,metadata)
      VALUES('Owner','PLATFORM_OWNER','Created partner invitation','Partners',$1,$2)`,
    [state.sourceId,{partnerId:state.partnerId,invitedEmail:state.email,clerkInvitationId:"old-provider-invite"}]);
    state.invitations.push({id:"old-provider-invite",status:"pending",emailAddress:state.email});
    state.create.mockReset().mockImplementation(async input=>{
      if(state.mode==="rejected")throw Object.assign(new Error("provider secret internal detail"),{status:422});
      if(!input.ignoreExisting&&state.invitations.some(i=>i.emailAddress===input.emailAddress&&i.status==="pending")){
        throw Object.assign(new Error("Duplicate pending invitation"),{status:409});
      }
      const invitation={id:`provider-${randomUUID()}`,status:"pending",...input};
      state.invitations.push(invitation);
      if(state.mode==="lost")throw new Error("private provider response lost");
      return invitation;
    });
    state.revoke.mockReset().mockImplementation(async id=>{
      const row=state.invitations.find(i=>i.id===id);
      if(row)row.status="revoked";
      return row??{};
    });
  });
  afterAll(async()=>{
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await pool.end();
  });
  const resend=(id=state.sourceId)=>fetch(`${url}/platform/partners/${state.partnerId}/invitations/resend`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({invitationId:id}),
  });
  it.each([false,true])("resends a valid source, including expired=%s, without SQL inference failure",async expired=>{
    if(expired)await pool.query(`UPDATE partner_invitations SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1`,[state.sourceId]);
    const response=await resend();
    expect(response.status,await response.clone().text()).toBe(201);
    expect(state.create).toHaveBeenCalledTimes(1);
    const input=state.create.mock.calls[0][0];
    expect(input).toMatchObject({emailAddress:state.email,expiresInDays:7,notify:true,ignoreExisting:true});
    const token=new URL(input.redirectUrl).searchParams.get("partnerInvitation");
    expect(token).toBeTruthy();
    const row=(await pool.query(`SELECT * FROM partner_invitations WHERE partner_profile_id=$1 AND status='ACTIVE'`,[state.partnerId])).rows;
    expect(row).toHaveLength(1);
    expect(row[0].token_hash).toBe(createHash("sha256").update(token!).digest("hex"));
    expect(row[0].expires_at.getTime()).toBeGreaterThan(Date.now()+6*86400000);
    expect((await resend()).status).toBe(404);
    expect(state.create).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid and revoked source IDs without sending",async()=>{
    expect((await resend(2147483647)).status).toBe(404);
    await pool.query(`UPDATE partner_invitations SET status='REVOKED',revoked_at=NOW() WHERE id=$1`,[state.sourceId]);
    expect((await resend()).status).toBe(404);
    expect(state.create).not.toHaveBeenCalled();
  });
  it("denies School Admin access before touching provider or invitation",async()=>{
    state.owner=false;expect((await resend()).status).toBe(403);
    expect(state.create).not.toHaveBeenCalled();
  });
  it("serializes concurrent retries without issuing two provider requests",async()=>{
    const responses=await Promise.all([resend(),resend()]);
    expect(responses.map(r=>r.status).sort()).toEqual(expect.arrayContaining([201]));
    expect(responses.every(r=>[201,404,409].includes(r.status))).toBe(true);
    expect(state.create).toHaveBeenCalledTimes(1);
  });
  it("preserves the original on definite provider failure and returns a sanitized actionable error",async()=>{
    state.mode="rejected";const response=await resend();
    expect(response.status).toBe(409);
    const text=await response.text();
    expect(text).not.toContain("provider secret");
    expect(text).toMatch(/Clerk|invitation|retry/i);
    expect((await pool.query(`SELECT status FROM partner_invitations WHERE id=$1`,[state.sourceId])).rows[0].status).toBe("ACTIVE");
    expect(state.revoke).not.toHaveBeenCalled();
  });
  it("reconciles a lost provider response without resending or changing the original token prematurely",async()=>{
    state.mode="lost";const response=await resend();
    expect(response.status).toBe(503);
    expect((await pool.query(`SELECT status FROM partner_invitations WHERE id=$1`,[state.sourceId])).rows[0].status).toBe("ACTIVE");
    // Recovery observes all provider statuses and matches the durable attempt marker.
    const recovery=await resend();
    expect(recovery.status,await recovery.clone().text()).toBe(200);
    expect(state.create).toHaveBeenCalledTimes(1);
  });
  it("corrects the selected Owner invitation email through the same typed recovery checks",async()=>{
    const email=`corrected-${randomUUID()}@example.test`;
    const response=await fetch(`${url}/platform/partners/${state.partnerId}`,{
      method:"PATCH",headers:{"content-type":"application/json"},
      body:JSON.stringify({email,invitationId:state.sourceId}),
    });
    expect(response.status,await response.clone().text()).toBe(200);
    expect(state.create).toHaveBeenCalledTimes(1);
    expect((await pool.query(`SELECT email FROM partner_profiles WHERE id=$1`,[state.partnerId])).rows[0].email).toBe(email);
  });
  it.each(["STANDARD","FINANCE","ADMIN"])("resends a Partner %s staff invitation using real typed recovery SQL",async permission=>{
    state.owner=false;state.partnerActor=true;
    await pool.query(`UPDATE partner_profiles SET user_id=$2,status='ACTIVE' WHERE id=$1`,[state.partnerId,state.ownerId]);
    const role={STANDARD:"PARTNER_STAFF",FINANCE:"PARTNER_FINANCE",ADMIN:"PARTNER_ADMIN"}[permission]!;
    await pool.query(`UPDATE audit_logs SET action='Created partner staff invitation',metadata=$2 WHERE record_id=$1 AND module='Partners'`,
      [state.sourceId,{partnerId:state.partnerId,invitedEmail:state.email,clerkInvitationId:"old-provider-invite",permission,role}]);
    const list=await fetch(`${url}/partner/staff/invitations`);
    expect(list.status,await list.clone().text()).toBe(200);
    const response=await fetch(`${url}/partner/staff-invitations/${state.sourceId}/resend`,{
      method:"POST",headers:{"content-type":"application/json"},body:"{}",
    });
    expect(response.status,await response.clone().text()).toBe(201);
    expect(state.create).toHaveBeenCalledTimes(1);
    expect((await pool.query(`SELECT status FROM partner_invitations WHERE id=$1`,[state.sourceId])).rows[0].status).toBe("REVOKED");
  });
});
