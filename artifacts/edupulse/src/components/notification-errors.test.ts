import {describe,expect,it} from 'vitest';
import {telegramCheckError,telegramReasons,notificationErrorClass} from './notification-errors';
describe('sanitized notification error copy',()=>{
  it('distinguishes safe server reasons, Development-only, session and rate limits',()=>{
    expect(telegramCheckError({status:503,data:{reason:'CHECK_AUDIT_UNAVAILABLE'}})).toBe(telegramReasons.CHECK_AUDIT_UNAVAILABLE);
    expect(telegramCheckError({status:404})).toContain('Development-only');
    expect(telegramCheckError({status:401})).toContain('Sign in again');
    expect(telegramCheckError({status:429})).toContain('ten seconds');
  });
  it('never echoes response messages, headers or unknown reasons',()=>{
    const result=telegramCheckError({message:'secret',headers:{Authorization:'secret'},data:{reason:'secret',error:'secret'}});
    expect(result).not.toContain('secret');
    expect(notificationErrorClass).toContain('text-[#991b1b]');
    expect(notificationErrorClass).toContain('bg-[#fff1f2]');
  });
});
