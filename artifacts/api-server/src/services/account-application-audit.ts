import type { DatabasePoolClient } from "@workspace/db";
import type { UserContext } from "../middlewares/auth";

export async function auditAccountApplication(client: DatabasePoolClient, actor: UserContext, id: number, action: string, metadata: object) {
  await client.query(`INSERT INTO audit_logs
    ("user",role,actor_user_id,clerk_user_id,action,module,record_id,severity,event_type,result,metadata)
    VALUES($1,$2,$3,$4,$5,'Account Applications',$6,'info','ACCOUNT_APPLICATION','SUCCESS',$7::jsonb)`,
  [actor.user.email, actor.roles.some(r => r.role === "PLATFORM_OWNER") ? "PLATFORM_OWNER" : "APPLICANT",
    actor.user.id, actor.user.clerkUserId, action, id, JSON.stringify(metadata)]);
}
