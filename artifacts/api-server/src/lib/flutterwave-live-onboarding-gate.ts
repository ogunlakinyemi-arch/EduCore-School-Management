import type {StudentSubscriptionSqlPool} from "./student-subscription-billing";
import {flutterwaveLiveWebhookVerifier} from "./flutterwave-live-config";
import {configuredStudentSubscriptionCheckoutBaseUrl} from "./student-subscription-return-url";
import {getActivePayrollEncryptionKey} from "./payroll-bank-encryption";
import {flutterwavePaymentMode} from "./flutterwave-payment-mode";
export const LIVE_ONBOARDING_RELEASE="SCV3_SCHOOL_ONBOARDING_V1";
/** A separate release: NEVER requires, toggles or grants LIVE checkout enabled. */
export function onboardingConfiguration(env:NodeJS.ProcessEnv){
  const blockers:string[]=[];
  const required=(ok:unknown,code:string)=>{if(!ok)blockers.push(code);};
  required(env.NODE_ENV==="production","PRODUCTION_RUNTIME_REQUIRED");
  required(flutterwavePaymentMode(env)==="LIVE","EXPLICIT_LIVE_MODE_REQUIRED");
  required(env.EDUCORE_FLUTTERWAVE_LIVE_ONBOARDING_ENABLED==="true","LIVE_ONBOARDING_ENABLEMENT_REQUIRED");
  required(env.EDUCORE_FLUTTERWAVE_ONBOARDING_RELEASE===LIVE_ONBOARDING_RELEASE,"LIVE_ONBOARDING_RELEASE_APPROVAL_REQUIRED");
  required(/^[A-Za-z0-9_-]{8,80}$/.test(env.EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE??""),"REVIEWED_MERCHANT_SCOPE_REQUIRED");
  required(/^FLWSECK-(?!TEST-)[A-Za-z0-9_-]{8,}$/.test(env.FLUTTERWAVE_LIVE_SECRET_KEY??""),"DEDICATED_LIVE_CREDENTIAL_REQUIRED");
  required(env.FLUTTERWAVE_KYC_APPROVED==="true","MERCHANT_KYC_APPROVAL_REQUIRED");
  required(env.FLUTTERWAVE_SUBACCOUNT_CREATION_CONFIRMED==="true","LIVE_SUBACCOUNT_API_PERMISSION_REQUIRED");
  required(env.FLUTTERWAVE_SUBACCOUNT_DEFAULTS_CONFIRMED==="true","SUBACCOUNT_DEFAULT_SPLIT_POLICY_REVIEW_REQUIRED");
  const liveHash=flutterwaveLiveWebhookVerifier(env),testHash=env.FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH;
  required(!!liveHash&&liveHash.length>=16&&liveHash===liveHash.trim(),"LIVE_WEBHOOK_BINDING_REQUIRED");
  required(testHash===undefined||(testHash===testHash.trim()&&testHash.length>=16&&testHash!==liveHash),"DISTINCT_TEST_WEBHOOK_BINDING_REQUIRED");
  required(!!env.PUBLIC_APP_URL&&!!configuredStudentSubscriptionCheckoutBaseUrl({
    environment:"production",publicAppUrl:env.PUBLIC_APP_URL}),"REVIEWED_PUBLIC_APP_URL_REQUIRED");
  try{getActivePayrollEncryptionKey(env);}catch{blockers.push("BANK_ENCRYPTION_CONFIGURATION_REQUIRED");}
  return {blockers,merchantScope:env.EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE??""};
}
export async function onboardingGate(pool:StudentSubscriptionSqlPool,env:NodeJS.ProcessEnv){
  const result=onboardingConfiguration(env);
  if(result.blockers.length)return result;
  const db=await pool.connect();
  try{
    const schema=(await db.query(`SELECT
      to_regclass('flutterwave_live_school_onboarding') IS NOT NULL
      AND to_regclass('flutterwave_live_school_onboarding_releases') IS NOT NULL
      AND to_regclass('flutterwave_live_school_onboarding_audits') IS NOT NULL
      AND (SELECT count(*)=3 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled IN('O','A')
       AND ((tgrelid=to_regclass('flutterwave_live_school_onboarding') AND tgname IN('live_school_onboarding_history','live_school_onboarding_audit'))
         OR(tgrelid=to_regclass('flutterwave_live_school_onboarding_audits') AND tgname='live_school_onboarding_audit_history'))) AS ready`)).rows[0];
    if(!schema?.ready){result.blockers.push("LIVE_ONBOARDING_SCHEMA_APPROVAL_REQUIRED");return result;}
    const approved=(await db.query(`SELECT r.release_id FROM flutterwave_live_school_onboarding_releases r
      WHERE r.release_id=$1 AND r.merchant_scope=$2 AND r.enabled AND r.schema_version=1 AND r.verified_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM app_users u JOIN school_memberships m ON m.user_id=u.id
        WHERE u.id=r.reviewed_by AND u.status='ACTIVE' AND m.role='PLATFORM_OWNER' AND m.school_id IS NULL AND m.status='ACTIVE')`,
    [LIVE_ONBOARDING_RELEASE,result.merchantScope])).rows[0];
    if(!approved)result.blockers.push("LIVE_ONBOARDING_TARGET_RELEASE_APPROVAL_REQUIRED");
  }catch{result.blockers.push("LIVE_ONBOARDING_SCHEMA_APPROVAL_REQUIRED");}
  finally{db.release();}
  return result;
}
