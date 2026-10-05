import {clerkClient} from "@clerk/express";
import {pool} from "@workspace/db";
import {AuthError} from "../middlewares/auth";

type Recovery={userId:number;clerkUserId:string;email:string;metadata:Record<string,unknown>;employeeId:number;schoolId:number|null};
/** Called only after the original server HMAC and verified email were checked. */
export async function recoverLegacyInternalInvitation(input:Recovery) {
  const prior=await pool.query(
    `SELECT id FROM audit_logs WHERE module='Company Employees' AND record_id=$1
      AND event_type IN ('INTERNAL_EMPLOYEE_INVITED','INTERNAL_EMPLOYEE_INVITATION_RESENT',
        'INTERNAL_EMPLOYEE_INVITATION_INVALIDATED','INTERNAL_EMPLOYEE_INVITATION_ACCEPTED') LIMIT 1`,
    [input.employeeId],
  );
  if(prior.rows.length) return;
  let matched:any;
  try {
    for(let offset=0;offset<1000;offset+=100) {
      const page=await clerkClient.invitations.getInvitationList({status:"accepted",limit:100,offset});
      matched=page.data.find(invitation=>{
        const claim=(invitation.publicMetadata as any)?.edupulseInternalEmployeeInvitation;
        return invitation.status==="accepted" &&
          invitation.emailAddress.toLowerCase()===input.email &&
          claim?.claimId===input.metadata.claimId &&
          claim?.employeeId===input.employeeId && claim?.role===input.metadata.role &&
          claim?.schoolId===input.schoolId && claim?.signature===input.metadata.signature;
      });
      if(matched || page.data.length<100) break;
    }
  } catch {
    throw new AuthError(503,"The account was created, but invitation confirmation is temporarily unavailable. Retry to complete activation.","INVITATION_ACTIVATION_PENDING");
  }
  if(!matched) throw new AuthError(403,"No accepted invitation matches this invited account");
  const created=matched.createdAt>1e12?matched.createdAt:matched.createdAt*1000;
  const expires=new Date(created+7*24*60*60*1000);
  if(!Number.isFinite(created) || expires.getTime()<=Date.now()) throw new AuthError(403,"This invitation has expired");
  const db=await pool.connect();
  try {
    await db.query("BEGIN");
    const employee=await db.query(
      `SELECT e.id FROM platform_company_employees e
        WHERE e.id=$1 AND lower(e.email)=lower($2) AND e.status='ACTIVE'
          AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.record_id=e.id
            AND a.module='Company Employees' AND a.event_type='PLATFORM_COMPANY_EMPLOYEE_CREATED'
            AND a.role='PLATFORM_OWNER' AND a.result='SUCCESS'
            AND a.timestamp BETWEEN $3::timestamptz-interval '10 minutes' AND $3::timestamptz+interval '10 minutes')
        FOR UPDATE OF e`,
      [input.employeeId,input.email,new Date(created).toISOString()],
    );
    if(!employee.rows.length) throw new AuthError(403,"Owner-created employee evidence for this invitation is missing");
    const newer=await db.query(
      `SELECT id FROM audit_logs WHERE module='Company Employees' AND record_id=$1
        AND event_type IN ('INTERNAL_EMPLOYEE_INVITED','INTERNAL_EMPLOYEE_INVITATION_RESENT',
          'INTERNAL_EMPLOYEE_INVITATION_INVALIDATED','INTERNAL_EMPLOYEE_INVITATION_ACCEPTED') LIMIT 1`,
      [input.employeeId],
    );
    if(!newer.rows.length) await db.query(
      `INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,action,module,record_id,event_type,result,metadata)
        VALUES($1,'PLATFORM_OWNER',NULL,NULL,'Reconciled original Owner employee invitation',
          'Company Employees',$2,'INTERNAL_EMPLOYEE_INVITED','SUCCESS',$3::jsonb)`,
      [input.email,input.employeeId,JSON.stringify({
        claimId:input.metadata.claimId,invitationId:matched.id,role:input.metadata.role,
        schoolId:input.schoolId,email:input.email,expiresAt:expires.toISOString(),reconciled:true,
      })],
    );
    await db.query("COMMIT");
  } catch(error) {
    await db.query("ROLLBACK").catch(()=>undefined);throw error;
  } finally {db.release();}
}
