import {demand,type CurrentSql} from "./current-financial-contract";
import {requireCurrentLifecycle} from "./current-financial-store";
export const extensionTables=["current_payment_batches","current_bulk_allocations","current_bulk_confirmations",
  "current_bulk_events","current_bulk_bro_entitlements","current_bro_withdrawals","current_bro_withdrawal_lines",
  "current_bro_withdrawal_decisions","bro_field_sms_permissions","bro_field_sms_campaigns",
  "bro_field_sms_recipients","bro_field_sms_events"];
export async function requireCurrentExtensions(c:CurrentSql){
  await requireCurrentLifecycle(c);
  const row=(await c.query(`SELECT count(*)::int AS count FROM pg_trigger t
    JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname='public' AND r.relname=ANY($1::text[]) AND t.tgname=r.relname||'_history'
      AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=27
      AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0
      AND p.proname='guard_student_direct_history' AND p.pronamespace=n.oid`,[extensionTables])).rows[0];
  demand(row?.count===extensionTables.length,"CURRENT_EXTENSIONS_MIGRATION_AND_HISTORY_GUARDS_REQUIRED");
  const guards=(await c.query(`SELECT count(*)::int AS count FROM pg_trigger t
    JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public'
    AND (r.relname,t.tgname) IN (('current_bulk_allocations','current_bulk_allocation_scope'),
      ('current_bulk_bro_entitlements','current_bulk_bro_scope'))
    AND t.tgenabled='O' AND t.tgtype=7 AND NOT t.tgisinternal
    AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0
    AND p.proname='guard_current_bulk_scope' AND p.pronamespace=n.oid`)).rows[0];
  demand(guards?.count===2,"CURRENT_AGGREGATE_SCOPE_GUARDS_REQUIRED");
}
export async function currentFinanceActor(c:CurrentSql,actorId:number){
  const row=(await c.query(`SELECT u.id,
    EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.status='ACTIVE'
      AND m.role='PLATFORM_OWNER' AND m.school_id IS NULL) AS owner,
    (SELECT p.id FROM partner_profiles p WHERE p.user_id=u.id AND p.status='ACTIVE'
      AND EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.role='PARTNER' AND m.status='ACTIVE')
      ORDER BY p.id LIMIT 1) AS partner_id
    FROM app_users u WHERE u.id=$1 AND u.status='ACTIVE'
    AND NOT EXISTS(SELECT 1 FROM school_memberships x WHERE x.user_id=u.id AND x.status='ACTIVE'
      AND x.role IN ('DEVICE_ACTIVATION_OFFICER','COMPANY_ACCOUNTANT')) FOR SHARE OF u`,[actorId])).rows[0];
  demand(row,"CURRENT_FINANCE_ACCESS_DENIED");
  return {owner:row.owner===true,partnerId:row.partner_id?Number(row.partner_id):null};
}
export async function currentSchoolAuthority(c:CurrentSql,actorId:number,schoolId:number){
  const a=await currentFinanceActor(c,actorId);
  const row=(await c.query(`SELECT s.id FROM schools s WHERE s.id=$2 AND lower(s.status)='active'
    AND ($3::boolean OR EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=$1
      AND m.school_id=s.id AND m.status='ACTIVE' AND m.role IN ('SCHOOL_ADMIN','ACCOUNTANT')))
    FOR SHARE OF s`,[actorId,schoolId,a.owner])).rows[0];
  demand(row,"SCHOOL_FINANCIAL_SCOPE_NOT_AUTHORIZED");
  return a;
}
export function entitlementKey(row:any){return row.bulk_entitlement_id?`B:${row.bulk_entitlement_id}`:`D:${row.entitlement_id??row.id}`;}
export function parseEntitlementKey(key:string){
  demand(/^[DB]:[1-9][0-9]{0,14}$/.test(key),"INVALID_ENTITLEMENT_KEY");
  return key[0]==="D"?Number(key.slice(2)):{bulkEntitlementId:Number(key.slice(2))};
}
