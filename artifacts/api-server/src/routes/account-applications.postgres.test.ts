import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// This file is run only by the isolated-cluster rehearsal script.
const enabled = Boolean(process.env.APPLICATION_TEST_SOCKET);
const state = vi.hoisted(() => ({
  userId: 0, ownerId: 0, accountStatus: "ACTIVE",
  provider: "resend", send: vi.fn(), clerkEmail: "applicant@example.test",
  verified: true, role: "APPLICANT", denied: false,
}));
vi.mock("@workspace/db", async () => {
  const { DatabasePool } = await import("@workspace/db/driver");
  return { pool: new DatabasePool({ host: process.env.APPLICATION_TEST_SOCKET ?? "/tmp/never",
    port: Number(process.env.APPLICATION_TEST_PORT ?? 1), database: "postgres", user: "postgres" }) };
});
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: `application_user_${state.userId}` }),
  clerkClient: { users: { getUser: vi.fn(async () => ({
    primaryEmailAddressId:"primary",emailAddresses:[{id:"primary",emailAddress:state.clerkEmail,verification:{status:state.verified ? "verified":"unverified"}}],
  })) } },
}));
vi.mock("../services/communication-providers", () => ({
  createEmailProvider: () => ({provider:state.provider,send:state.send}),
}));
// Actual authentication middleware and role checks run, with synthetic provider identity.
import { pool } from "@workspace/db";
import router from "./account-applications";
import { loadUserContext, requireAuthentication } from "../middlewares/auth";
import { decideApplication } from "../services/account-applications";

describe.skipIf(!enabled)("account applications on isolated PostgreSQL", () => {
  let server: Server, url: string;
  const payload = (applicantType = "PARTNER") => ({
    applicantType,firstName:"Application",lastName:"Tester",phone:"+2348000000000",
    city:"Lagos",state:"Lagos", ...(applicantType === "SCHOOL_ADMIN" ? {schoolName:"Application QA School"} : {}),
  });
  const call = (path: string, body?: unknown) => fetch(`${url}${path}`, {
    method: body ? "POST":"GET", headers:{"content-type":"application/json"},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
  async function submit(type="PARTNER") {
    const r = await call("/account-application",payload(type));
    expect(r.status, await r.clone().text()).toBe(201);
    return r.json() as Promise<{id:number;status:string}>;
  }
  beforeAll(async () => {
    const owner = await pool.query(`INSERT INTO app_users(clerk_user_id,email,first_name,last_name)
      VALUES('application_owner','owner@example.test','Owner','Tester') RETURNING id`);
    state.ownerId=owner.rows[0].id;
    await pool.query(`UPDATE app_users SET clerk_user_id=$2 WHERE id=$1`,[state.ownerId,`application_user_${state.ownerId}`]);
    await pool.query(`INSERT INTO school_memberships(user_id,role,status) VALUES($1,'PLATFORM_OWNER','ACTIVE')`,[state.ownerId]);
    const app=express();app.use(express.json());app.use(router);
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({error:error.message});
    });
    app.get("/protected",requireAuthentication(),(_req,res)=>res.json({ok:true}));
    await new Promise<void>(resolve => {server=app.listen(0,"127.0.0.1",()=>resolve())});
    url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  });
  beforeEach(async () => {
    state.verified=true; state.provider="resend";
    state.send.mockReset().mockResolvedValue({accepted:true,status:"ACCEPTED"});
    const suffix=crypto.randomUUID();
    const user=await pool.query(`INSERT INTO app_users(clerk_user_id,email) VALUES($1,$2) RETURNING id`,
      [`application_user_${suffix}`,`apply-${suffix}@example.test`]);
    state.userId=user.rows[0].id;
    await pool.query(`UPDATE app_users SET clerk_user_id=$2 WHERE id=$1`,[state.userId,`application_user_${state.userId}`]);
    state.clerkEmail=`apply-${suffix}@example.test`;
  });
  afterAll(async()=>{
    server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await pool.end();
  });

  it("creates pending records without school, partner or memberships and masks all operational roles",async()=>{
    const a=await submit();
    expect(a.status).toBe("PENDING");
    expect((await pool.query(`SELECT * FROM school_memberships WHERE user_id=$1`,[state.userId])).rows).toHaveLength(0);
    // Even an independently added active grant cannot bypass the application gate.
    await pool.query(`INSERT INTO school_memberships(user_id,role,status) VALUES($1,'PARTNER','ACTIVE')`,[state.userId]);
    const ctx=await loadUserContext(`application_user_${state.userId}`);
    expect(ctx.roles).toEqual([]);expect(ctx.applicationStatus).toBe("PENDING");
    expect((await call("/protected")).status).toBe(403);
    expect((await call("/account-application")).status).toBe(200);
  });
  it.each(["TEACHER","STAFF","PARENT","STUDENT","PLATFORM_OWNER"])("rejects public %s applications",async(type)=>{
    expect((await call("/account-application",payload(type))).status).toBe(400);
  });
  it("rejects unverified email and forged identity/status fields",async()=>{
    state.verified=false;expect((await call("/account-application",payload())).status).toBe(403);
    state.verified=true;
    expect((await call("/account-application",{...payload(),status:"APPROVED",userId:state.ownerId})).status).toBe(400);
  });
  it("rejects missing school details, duplicates and existing memberships without changing existing access",async()=>{
    expect((await call("/account-application",{...payload(),applicantType:"SCHOOL_ADMIN"})).status).toBe(400);
    await pool.query(`INSERT INTO school_memberships(user_id,role,status) VALUES($1,'PARTNER','ACTIVE')`,[state.userId]);
    expect((await call("/account-application",payload())).status).toBe(409);
    expect((await loadUserContext(`application_user_${state.userId}`)).roles[0].role).toBe("PARTNER");
  });
  it("serializes duplicate submissions and never creates duplicate grants",async()=>{
    const rs=await Promise.all([call("/account-application",payload()),call("/account-application",payload())]);
    expect(rs.map(r=>r.status).sort()).toEqual([201,409]);
  });
  it.each(["PARTNER","SCHOOL_ADMIN"])("approves %s exactly once, audits and sends approval email",async(type)=>{
    const a=await submit(type),userId=state.userId,email=state.clerkEmail;
    state.userId=state.ownerId;
    const rs=await Promise.all([call(`/platform/account-applications/${a.id}/decision`,{status:"APPROVED"}),
      call(`/platform/account-applications/${a.id}/decision`,{status:"APPROVED"})]);
    expect(rs.map(r=>r.status).sort()).toEqual([200,409]);
    const approved=await rs.find(r=>r.status===200)!.json() as {notificationStatus:string};
    expect(approved.notificationStatus).toBe("ACCEPTED");
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0]).toMatchObject({to:email});
    expect(state.send.mock.calls[0][0].body).toContain("can now log in");
    const roles=(await pool.query(`SELECT role FROM school_memberships WHERE user_id=$1`,[userId])).rows;
    expect(roles).toEqual([{role:type}]);
    const record=(await pool.query(`SELECT * FROM account_applications WHERE id=$1`,[a.id])).rows[0];
    if(type==="SCHOOL_ADMIN")expect((await pool.query(`SELECT status FROM schools WHERE id=$1`,[record.school_id])).rows[0].status).toBe("active");
    else expect((await pool.query(`SELECT status FROM partner_profile_users WHERE partner_profile_id=$1 AND user_id=$2`,[record.partner_profile_id,userId])).rows[0].status).toBe("ACTIVE");
    expect((await pool.query(`SELECT action FROM audit_logs WHERE module='Account Applications' AND record_id=$1`,[a.id])).rows.map(r=>r.action)).toContain("Approved account application");
    state.userId=userId;
    expect((await call("/protected")).status).toBe(200);
  });
  it("requires global Owner decisions; rejects and retains reason without granting access",async()=>{
    const a=await submit(),userId=state.userId;
    expect((await call("/platform/account-applications")).status).toBe(403);
    expect((await call(`/platform/account-applications/${a.id}/decision`,{status:"APPROVED"})).status).toBe(403);
    state.userId=state.ownerId;
    expect((await call(`/platform/account-applications/${a.id}/decision`,{status:"REJECTED"})).status).toBe(400);
    const rejected=await call(`/platform/account-applications/${a.id}/decision`,{status:"REJECTED",reason:"Details could not be verified"});
    expect(rejected.status).toBe(200);
    expect((await rejected.json() as {rejectionReason:string}).rejectionReason).toBe("Details could not be verified");
    expect(state.send.mock.calls[0][0].body).toContain("was not approved");
    expect((await pool.query(`SELECT * FROM school_memberships WHERE user_id=$1`,[userId])).rows).toHaveLength(0);
    state.userId=userId; expect((await call("/protected")).status).toBe(403);
  });
  it("does not roll back approval or resend after uncertain email; reports unavailable infrastructure",async()=>{
    const a=await submit(); state.userId=state.ownerId;
    state.send.mockRejectedValueOnce(new Error("response lost"));
    const r=await call(`/platform/account-applications/${a.id}/decision`,{status:"APPROVED"});
    expect((await r.json() as {notificationStatus:string}).notificationStatus).toBe("UNKNOWN");
    expect((await call(`/platform/account-applications/${a.id}/decision`,{status:"APPROVED"})).status).toBe(409);
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it.each(["development","http-email"])("reports the actual %s email capability without treating simulations as delivery",async(provider)=>{
    const a=await submit();state.userId=state.ownerId;state.provider=provider;
    const r=await call(`/platform/account-applications/${a.id}/decision`,{status:"APPROVED"});
    expect(r.status).toBe(200);
    expect((await r.json() as {notificationStatus:string}).notificationStatus).toBe(provider==="development"?"UNAVAILABLE":"ACCEPTED");
    expect(state.send).toHaveBeenCalledTimes(provider==="development"?0:1);
  });
  it("retains school referral attribution only after Owner approval and rejects invalid referrals",async()=>{
    expect((await call("/account-application",{...payload("SCHOOL_ADMIN"),referralToken:"invalid-referral-token"})).status).toBe(400);
    const token=crypto.randomUUID(),suffix=crypto.randomUUID();
    const partner=(await pool.query(`INSERT INTO partner_profiles(partner_code,full_name,email,status)
      VALUES($1,'Referral QA Partner',$2,'ACTIVE') RETURNING id`,[`QA-${suffix}`,`ref-${suffix}@example.test`])).rows[0];
    const link=(await pool.query(`INSERT INTO partner_referral_links(partner_profile_id,token_hash,status,created_by)
      VALUES($1,$2,'ACTIVE',$3) RETURNING id`,[partner.id,createHash("sha256").update(token).digest("hex"),state.ownerId])).rows[0];
    const submitted=await call("/account-application",{...payload("SCHOOL_ADMIN"),referralToken:token});
    expect(submitted.status).toBe(201);
    const a=await submitted.json() as {id:number};
    expect((await pool.query(`SELECT school_id FROM account_applications WHERE id=$1`,[a.id])).rows[0].school_id).toBeNull();
    state.userId=state.ownerId;
    const decision=await call(`/platform/account-applications/${a.id}/decision`,{status:"APPROVED"});
    expect(decision.status,await decision.clone().text()).toBe(200);
    expect((await pool.query(`SELECT source,partner_profile_id,referral_link_id FROM school_partner_attributions
      WHERE school_id=(SELECT school_id FROM account_applications WHERE id=$1)`,[a.id])).rows[0])
      .toMatchObject({source:"PARTNER_DIRECT",partner_profile_id:partner.id,referral_link_id:link.id});
  });
  it("rejects invalid SQL states and rolls back failed approval atomically",async()=>{
    const a=await submit("SCHOOL_ADMIN"),userId=state.userId;
    await expect(pool.query(`UPDATE account_applications SET status='APPROVED' WHERE id=$1`,[a.id])).rejects.toMatchObject({code:"23514"});
    await pool.query(`UPDATE app_users SET status='INACTIVE' WHERE id=$1`,[userId]);
    const actor=await loadUserContext(`application_user_${state.ownerId}`);
    await expect(decideApplication(actor,a.id,{status:"APPROVED"})).rejects.toThrow("inactive");
    expect((await pool.query(`SELECT status FROM account_applications WHERE id=$1`,[a.id])).rows[0].status).toBe("PENDING");
    expect((await pool.query(`SELECT * FROM schools WHERE name='Application QA School' AND email=$1`,[state.clerkEmail])).rows).toHaveLength(0);
  });
  it("has a purely additive migration with no existing-row update or delete",()=>{
    const sql=readFileSync(new URL("../../../../lib/db/drizzle/0169_account_applications.sql",import.meta.url),"utf8");
    expect(sql).not.toMatch(/\b(ALTER|UPDATE|DELETE|DROP)\b/);
  });
});
