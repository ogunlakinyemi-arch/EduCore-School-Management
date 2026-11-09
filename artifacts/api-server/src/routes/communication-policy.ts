import { Router } from "express";
import { z } from "zod";
import ownerNotificationDelivery from "./owner-notification-delivery";
import {loadOwnerDeliveryControls,ownerNotificationDevelopment} from "../services/owner-notification-controls";
import {bulkSmsConfigurationReady} from "../services/bulksmsnigeria-provider";
import {validVapidConfiguration,vapidConfiguration} from "../services/web-push-configuration";
import {getTelegramHealth} from "../services/telegram-provider";
import { pool, type DatabasePoolClient } from "@workspace/db";
import { AuthError, getUserContext, assertSchoolAccess, requireAuthentication } from "../middlewares/auth";
import { loadNotificationPolicy, notificationPolicySchema, notificationChannelAvailability,
  allowedNotificationChannels, effectiveNotificationChannels, policyEvents, policyValidationIssue, notificationChannelReadiness } from "../services/notification-channel-policy";
const router = Router();
router.use(requireAuthentication());
router.use(ownerNotificationDelivery);
const category = z.enum(policyEvents);
async function deliveryAvailability(db:Pick<typeof pool,"query">){
  const availability=notificationChannelAvailability();
  if(!ownerNotificationDevelopment())return availability;
  const controls=await loadOwnerDeliveryControls(db);
  return {...availability,
    SMS:!controls.paused&&controls.smsEnabled&&bulkSmsConfigurationReady(),
    PUSH:!controls.paused&&controls.pushEnabled&&!!controls.pushParentIds.length&&validVapidConfiguration(vapidConfiguration()),
    TELEGRAM:!controls.paused&&controls.telegramEnabled&&getTelegramHealth().ready};
}
async function ownerReadiness(db:Pick<typeof pool,"query">){
  const readiness=notificationChannelReadiness();
  if(!ownerNotificationDevelopment())return readiness;
  const [controls,availability]=await Promise.all([loadOwnerDeliveryControls(db),deliveryAvailability(db)]);
  for(const channel of ["SMS","PUSH","TELEGRAM"] as const){
    readiness[channel].deliveryReady=availability[channel];
    readiness[channel].deliveryHold=availability[channel]?null:controls.paused
      ?"Owner notification-only delivery is paused. Protected payment and subscription jobs remain independent."
      :"Owner channel enablement, eligible recipient selection or provider readiness is required.";
  }
  return readiness;
}
export const channelDefaultsSchema = z.record(category, z.array(z.enum(["IN_APP","PUSH","SMS","EMAIL","TELEGRAM"])).max(5));
function ownerContext(req:Parameters<typeof getUserContext>[0]){
  const ctx=getUserContext(req);
  if(!ctx.roles.some(r=>r.role==="PLATFORM_OWNER"&&r.status==="ACTIVE"))throw new AuthError(403,"Owner only");
  return ctx;
}
function access(req: Parameters<typeof getUserContext>[0], id: number, write: boolean) {
  if (!Number.isSafeInteger(id) || id < 1) throw new AuthError(400, "Invalid school");
  const ctx = assertSchoolAccess(req, id, ["SCHOOL_ADMIN"]);
  const owner = ctx.roles.some(r => r.role === "PLATFORM_OWNER");
  if (write && owner) throw new AuthError(403, "Owner access is read-only");
  return !owner;
}
router.get("/communication/schools/:schoolId/defaults", async (req, res) => {
  try {
    const id = Number(req.params.schoolId); const canWrite = access(req, id, false);
    const result = await pool.query(`SELECT communication_defaults AS defaults FROM schools WHERE id=$1`, [id]);
    if (!result.rows[0]) throw new AuthError(404, "School not found");
    const policy=await loadNotificationPolicy(pool);
    res.json({ defaults: result.rows[0].defaults, canWrite, availability:await deliveryAvailability(pool),
      effectiveDefaults:Object.fromEntries(policyEvents.map(e=>[e,effectiveNotificationChannels(policy,e,id,result.rows[0].defaults)])),
      allowed:Object.fromEntries(policyEvents.map(e=>[e,allowedNotificationChannels(policy,e,id)])) });
  } catch (e) { res.status(e instanceof AuthError ? e.statusCode : 500).json({ error: "Could not read school communication defaults" }); }
});
router.put("/communication/schools/:schoolId/defaults", async (req, res) => {
  const c = await pool.connect();
  try {
    const id = Number(req.params.schoolId); access(req, id, true);
    const defaults = channelDefaultsSchema.parse(req.body);
    await c.query("BEGIN");
    const policy=await loadNotificationPolicy(c),availability=await deliveryAvailability(c);
    for(const [event,selected] of Object.entries(defaults)){
      const allowed=allowedNotificationChannels(policy,event,id);
      if(selected?.some(channel=>!allowed.includes(channel)||!availability[channel]))
        throw new AuthError(403,"Channel unavailable or disallowed by Owner policy");
    }
    await c.query(`UPDATE schools SET communication_defaults=$2::jsonb WHERE id=$1`, [id, JSON.stringify(defaults)]);
    const actor = getUserContext(req);
    await c.query(`INSERT INTO audit_logs(school_id,actor_user_id,"user",role,action,module)
      VALUES($1,$2,$3,'SCHOOL_ADMIN','Updated category notification channel defaults','Communications')`,
      [id, actor.user.id, actor.user.email]);
    await c.query("COMMIT"); res.json({ defaults, canWrite: true });
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    res.status(e instanceof AuthError ? e.statusCode : e instanceof z.ZodError ? 400 : 500).json({ error: "Could not update school communication defaults" });
  } finally { c.release(); }
});
router.get("/communication/channel-policy",async(req,res)=>{
  try{
    ownerContext(req);
    res.json({policy:await loadNotificationPolicy(pool),availability:await deliveryAvailability(pool),
      readiness:await ownerReadiness(pool)});
  }catch(e){res.status(e instanceof AuthError?e.statusCode:500).json({error:"Could not read Owner channel policy"});}
});
router.put("/communication/channel-policy",async(req,res)=>{
  let c:DatabasePoolClient|undefined;
  try{
    const ctx=ownerContext(req);
    const reason=String(req.headers["x-notification-policy-reason"]??"").trim();
    if(process.env.NODE_ENV==="development"&&!process.env.REPLIT_DEPLOYMENT&&(reason.length<5||reason.length>500))
      throw new AuthError(400,"An Owner policy-change reason of 5–500 characters is required");
    const policy=notificationPolicySchema.parse(req.body);
    c=await pool.connect();
    await c.query("BEGIN");
    const issue=policyValidationIssue(policy,await loadNotificationPolicy(c),await deliveryAvailability(c));
    if(issue){
      await c.query("ROLLBACK");
      res.status(400).json({error:issue==="UNAVAILABLE_DEFAULT"
        ?"A channel without available delivery cannot become a default"
        :"School overrides can only include globally allowed channels",code:issue});
      return;
    }
    await c.query(`INSERT INTO audit_logs(actor_user_id,"user",role,action,module,event_type,metadata)
      VALUES($1,$2,'PLATFORM_OWNER','Updated event channels and school permissions','NotificationPolicy',
      'GLOBAL_CHANNEL_POLICY_UPDATED',$3::jsonb)`,
      [ctx.user.id,ctx.user.email,JSON.stringify({policy,reason:reason||"Existing Production policy update"})]);
    await c.query("COMMIT");res.json({policy,availability:await deliveryAvailability(pool),
      readiness:await ownerReadiness(pool)});
  }catch(e){
    await c?.query("ROLLBACK").catch(()=>undefined);
    res.status(e instanceof AuthError?e.statusCode:e instanceof z.ZodError?400:500).json({error:"Could not save Owner channel policy"});
  }finally{c?.release();}
});
export default router;