import {Router} from "express";
import {pool,type DatabasePoolClient} from "@workspace/db";
import {AuthError,getUserContext,requireAuthentication} from "../middlewares/auth";
import {deliveryControlInput,loadOwnerDeliveryControls,ownerNotificationDevelopment,pushTestCandidates} from "../services/owner-notification-controls";
import {ownerNotificationWorkerStatus} from "../services/owner-notification-worker";
import {bulkSmsConfigurationReady} from "../services/bulksmsnigeria-provider";
import {validVapidConfiguration,vapidConfiguration} from "../services/web-push-configuration";
import {z} from "zod";
const router=Router();
router.use((req,_res,next)=>{if(req.path!=="/communication/owner-delivery-controls")next("router");else next();});
router.use(requireAuthentication());
router.use((req,res,next)=>{
  try{
    const ctx=getUserContext(req);
    if(!ctx.roles.some(r=>r.role==="PLATFORM_OWNER"&&r.status==="ACTIVE"))throw new AuthError(403,"Owner only");
    if(!ownerNotificationDevelopment())throw new AuthError(404,"Development notification controls only");
    next();
  }catch(e){res.status(e instanceof AuthError?e.statusCode:403).json({error:"Owner Development controls unavailable"});}
});
const configuration=()=>({SMS:bulkSmsConfigurationReady(),PUSH:validVapidConfiguration(vapidConfiguration()),
  TELEGRAM:!!process.env.TELEGRAM_BOT_TOKEN&&!!process.env.SESSION_SECRET&&process.env.SESSION_SECRET.length>=32});
async function view(){
  const [controls,candidates,counts]=await Promise.all([loadOwnerDeliveryControls(pool),pushTestCandidates(pool),
    pool.query(`SELECT channel,status,
      CASE WHEN error_code IN ('CONFIGURATION','INVALID_REQUEST','NETWORK','TIMEOUT','UNKNOWN',
        'RATE_LIMITED','PROVIDER_REJECTED','PROVIDER_OUTCOME_UNKNOWN','RECIPIENT_UNAUTHORIZED',
        'RECIPIENT_PREFERENCE','OWNER_CHANNEL_POLICY','OWNER_DELIVERY_HELD','SIMULATED','SMS_SCOPE_OR_CONSENT_REQUIRED',
        'TELEGRAM_LINK_OR_CONSENT_REQUIRED') THEN error_code WHEN error_code IS NULL THEN 'NONE' ELSE 'OTHER' END AS category,
      count(*)::int AS count FROM communication_deliveries WHERE channel IN ('SMS','PUSH','TELEGRAM')
      GROUP BY channel,status,category ORDER BY channel,status,category`)]);
  return {controls,candidates,queue:counts.rows,configuration:configuration(),worker:ownerNotificationWorkerStatus(),
    protectedWorkersPaused:process.env.EDUCORE_DEVELOPMENT_WORKERS_PAUSED==="true",
    paymentTestNotificationsRestricted:process.env.EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED==="true"};
}
router.get("/communication/owner-delivery-controls",async(_req,res)=>{
  try{res.json(await view());}catch{res.status(503).json({error:"Notification diagnostics unavailable"});}
});
router.put("/communication/owner-delivery-controls",async(req,res)=>{
  let db:DatabasePoolClient|undefined;
  try{
    const input=deliveryControlInput.parse(req.body);
    const ctx=getUserContext(req),config=configuration();
    if((input.smsEnabled&&!config.SMS)||(input.pushEnabled&&!config.PUSH)||(input.telegramEnabled&&!config.TELEGRAM))
      throw new AuthError(400,"Selected channel configuration is incomplete");
    const candidates=await pushTestCandidates(pool);
    if(input.pushEnabled&&(!input.pushParentIds.length||input.pushParentIds.some(id=>!candidates.some(p=>p.userId===id&&p.eligible))))
      throw new AuthError(400,"Push requires an explicitly consenting parent or teacher with a valid active school device registration");
    db=await pool.connect();await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(31973,1)");
    const previous=await loadOwnerDeliveryControls(db);
    if(previous.version!==input.expectedVersion)throw new AuthError(409,"Controls changed; reload before saving");
    const {expectedVersion:_version,reason,...controls}=input;
    const activatedAt=new Date().toISOString();
    await db.query(`INSERT INTO audit_logs(actor_user_id,"user",role,action,module,event_type,result,school_id,metadata)
      VALUES($1,$2,'PLATFORM_OWNER','Updated Development notification-only delivery controls',
        'OwnerNotificationDelivery','DEVELOPMENT_DELIVERY_CONTROLS_UPDATED','SUCCESS',NULL,$3::jsonb)`,
      [ctx.user.id,ctx.user.email,JSON.stringify({controls:{...controls,pushParentIds:[...new Set(controls.pushParentIds)]},
        previous,reason,activatedAt})]);
    await db.query("COMMIT");
    res.json(await view());
  }catch(e){
    await db?.query("ROLLBACK").catch(()=>undefined);
    res.status(e instanceof AuthError?e.statusCode:e instanceof z.ZodError?400:500)
      .json({error:e instanceof AuthError?e.message:"Could not save notification delivery controls"});
  }finally{db?.release();}
});
export default router;
