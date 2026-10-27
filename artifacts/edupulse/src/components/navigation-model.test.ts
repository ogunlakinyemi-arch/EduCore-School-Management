import { describe, expect, it } from 'vitest';
import { buildNavSections, navMode, isNavActive, hasActiveGlobalOwner } from './navigation-model';

describe('navigation model', () => {
  it('puts the authorized school schedule directly under Attendance, without adding it for teachers', () => {
    expect(buildNavSections(['/attendance','/attendance/schedule'],'admin'))
      .toEqual([{id:'attendance',label:'Attendance',hrefs:['/attendance','/attendance/schedule']}]);
    expect(buildNavSections(['/attendance'],'teacher').flatMap(s=>s.hrefs)).not.toContain('/attendance/schedule');
  });
  it('keeps every authorized link exactly once', () => {
    const hrefs = ['/', '/students', '/library', '/unknown', '/settings-x'];
    const flat = buildNavSections(hrefs, 'admin').flatMap(s => s.hrefs).sort();
    expect(flat).toEqual(['/library', '/settings-x', '/students', '/unknown']);
  });
  it('does not add unauthorized links', () => {
    const s = buildNavSections(['/results'], 'teacher');
    expect(s.map(x => x.label)).toEqual(['Results']);
  });
  it('uses flat mode for restricted or other roles', () => {
    expect(navMode(['SCHOOL_ADMIN'], true)).toBe('flat');
    expect(navMode(['PARENT'], false)).toBe('flat');
    expect(navMode(['TEACHER'], false)).toBe('teacher');
    expect(navMode(['TEACHER', 'SCHOOL_ADMIN'], false)).toBe('admin');
  });
  it('matches query-specific destinations without breaking ordinary path activation',()=>{
    expect(isNavActive('/payment-settlement?tab=schools','/payment-settlement','tab=schools')).toBe(true);
    expect(isNavActive('/payment-settlement?tab=schools','/payment-settlement','?tab=history')).toBe(false);
    expect(isNavActive('/payment-settlement?tab=schools','/payment-settlement','')).toBe(false);
    expect(isNavActive('/payment-settlement?tab=schools','/other','tab=schools')).toBe(false);
    expect(isNavActive('/subscriptions','/subscriptions/retained-history')).toBe(true);
    expect(isNavActive('/','/subscriptions')).toBe(false);
    expect(isNavActive('/activation','/activation/history')).toBe(false);
  });
  it('does not infer active global ownership from a flag, inactive role, or school-scoped membership',()=>{
    const active={isPlatformOwner:true,user:{status:'ACTIVE'},roles:[{role:'PLATFORM_OWNER',schoolId:null,status:'ACTIVE'}]};
    expect(hasActiveGlobalOwner(active)).toBe(true);
    expect(hasActiveGlobalOwner({...active,isPlatformOwner:false})).toBe(false);
    expect(hasActiveGlobalOwner({...active,user:{}})).toBe(false);
    expect(hasActiveGlobalOwner({...active,roles:[{role:'PLATFORM_OWNER',status:'ACTIVE'}]})).toBe(false);
    expect(hasActiveGlobalOwner(undefined)).toBe(false);
  });
});

import { describe as d2, expect as e2, it as i2 } from 'vitest';
d2('owner attendance nav', () => {
  i2('keeps /platform/attendance in flat owner mode', () => { e2(buildNavSections(['/', '/platform/attendance'], 'flat')).toEqual([]); });
});
