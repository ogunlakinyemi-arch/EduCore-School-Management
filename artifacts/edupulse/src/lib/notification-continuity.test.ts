import {describe,it,expect} from 'vitest';
import {deliveryStatusLabel,deliveryNextAction} from '../pages/communication-contract';
import {fieldSmsDiagnostic} from './field-sms-diagnostics';
describe('independent channel continuity and safe next actions',()=>{
  it.each([
    ['QUEUED','TELEGRAM_WAITING_FOR_LINK','Waiting for your Telegram connection','Connect your own Telegram'],
    ['QUEUED','TELEGRAM_UNAVAILABLE','Waiting for Telegram service recovery','Wait for service recovery'],
    ['FAILED','PROVIDER_OUTCOME_UNKNOWN','Outcome unknown','Do not resend'],
    ['CANCELLED','NOTICE_EXPIRED_OR_CANCELLED','Expired or no longer current','will not resume'],
    ['CANCELLED','TELEGRAM_CONSENT_WITHDRAWN','CANCELLED','Not automatically resumed'],
    ['SENT',null,'Accepted · delivery not confirmed',null],
    ['DELIVERED',null,'Delivered',null],
  ])('explains %s / %s without claiming an unconfirmed send',(status,errorCode,label,next)=>{
    const d={status,errorCode,provider:null} as any;
    expect(deliveryStatusLabel(d)).toContain(label);
    if(next)expect(deliveryNextAction(d)).toContain(next);else expect(deliveryNextAction(d)).toBeNull();
  });
  it.each([
    ['CURRENT_FINANCIAL_SCHEMA_NOT_APPLIED','storage is not applied'],
    ['CURRENT_LIFECYCLE_MIGRATION_NOT_APPLIED','lifecycle is not applied'],
    ['EXISTING_FINANCIAL_GUARDS_REQUIRED','protections are missing'],
    ['CURRENT_EXTENSIONS_MIGRATION_AND_HISTORY_GUARDS_REQUIRED','history guards are missing'],
    ['CURRENT_AGGREGATE_SCOPE_GUARDS_REQUIRED','protection is missing'],
    ['SMS_DELIVERY_PAUSED_BY_OWNER','paused by the Owner'],
    ['SMS_NOT_AUTHORIZED_BY_OWNER','not enabled SMS'],
    ['SMS_PROVIDER_NOT_CONFIGURED','SMS provider is unavailable'],
    ['CONTACT_PERMISSION_REQUIRED','not given the required permission'],
  ])('separates safe Field SMS blocker %s',(code,label)=>{
    const d=fieldSmsDiagnostic({status:503,data:{error:code}});expect(d.title).toContain(label);expect(d.next.length).toBeGreaterThan(10);
  });
  it('distinguishes route, runtime, session and permission without echoing provider/private error text',()=>{
    expect(fieldSmsDiagnostic({status:404}).code).toBe('FIELD_SMS_ROUTE_UNAVAILABLE');
    expect(fieldSmsDiagnostic({status:503}).code).toBe('FIELD_SMS_READINESS_UNKNOWN');
    expect(fieldSmsDiagnostic({status:401}).code).toBe('SESSION_REQUIRED');
    expect(fieldSmsDiagnostic({status:403}).code).toBe('OWNER_PERMISSION_REQUIRED');
    expect(JSON.stringify(fieldSmsDiagnostic({status:503,data:{error:'private error https://provider.invalid/?token=not-real'}}))).not.toContain('token=');
  });
});
