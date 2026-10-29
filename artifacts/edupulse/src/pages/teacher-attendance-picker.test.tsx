// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({classes:[] as any[],error:false,fetching:false,attendance:vi.fn(),refetch:vi.fn()}));
vi.mock('@workspace/api-client-react',async original=>({
  ...await original<typeof import('@workspace/api-client-react')>(),
  useGetAuthorizedContext:()=>({data:{user:{id:30}},isError:false}),
  useListClasses:()=>({data:f.classes,isLoading:false,isError:f.error,isFetching:f.fetching,refetch:f.refetch}),
  useGetClassAttendance:(...args:any[])=>{f.attendance(...args);return{data:[],isError:false,isLoading:false};},
}));
vi.mock('@/components/shared',async original=>({
  ...await original<typeof import('@/components/shared')>(),TenantPicker:()=>null,
}));
import { TeacherClassAttendance } from './attendance';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
  f.classes=[{id:21,schoolId:1,name:'Basic 3',section:'A'},{id:22,schoolId:1,name:'Basic 4',section:'B'}];
  f.error=false;f.fetching=false;f.attendance.mockClear();
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const mount=()=>act(async()=>root.render(<TeacherClassAttendance schoolId={1}/>));
it('offers assigned class names, not a manual ID, and loads the selected class/day',async()=>{
  await mount();
  const select=host.querySelector('select')!;
  expect([...select.options].map(o=>o.textContent)).toEqual(['Choose an assigned class','Basic 3 · A','Basic 4 · B']);
  expect(host.querySelector('input[type=number]')).toBeNull();
  expect(f.attendance.mock.lastCall?.[2].query.enabled).toBe(false);
  await act(async()=>{select.value='21';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(f.attendance.mock.lastCall?.[0]).toBe(21);
  expect(f.attendance.mock.lastCall?.[2].query.enabled).toBe(true);
  const date=host.querySelector<HTMLInputElement>('input[type=date]')!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(date,'2026-10-28');
    date.dispatchEvent(new Event('input',{bubbles:true}));date.dispatchEvent(new Event('change',{bubbles:true}));
  });
  expect(f.attendance.mock.lastCall?.[1]).toEqual({schoolId:1,date:'2026-10-28'});
});
it('shows no-assignment guidance and never enables arbitrary attendance queries',async()=>{
  f.classes=[];await mount();
  expect(host.textContent).toContain('No classes assigned');
  expect(host.querySelector('select')!.disabled).toBe(true);
  expect(f.attendance.mock.calls.every(c=>c[2].query.enabled===false)).toBe(true);
});
it('rejects injected IDs and immediately stops showing a revoked selection',async()=>{
  await mount();const select=host.querySelector('select')!;
  const option=document.createElement('option');option.value='999';select.append(option);
  await act(async()=>{select.value='999';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(f.attendance.mock.lastCall?.[2].query.enabled).toBe(false);
  await act(async()=>{select.value='21';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(f.attendance.mock.lastCall?.[2].query.enabled).toBe(true);
  f.classes=[];await mount();
  expect(host.textContent).toContain('No classes assigned');
  expect(f.attendance.mock.lastCall?.[2].query.enabled).toBe(false);
});
it('fails closed on unavailable class options and excludes a foreign-school option',async()=>{
  f.classes.push({id:31,schoolId:2,name:'Foreign class'});await mount();
  expect(host.textContent).not.toContain('Foreign class');
  f.error=true;await mount();
  expect(f.attendance.mock.lastCall?.[2].query.enabled).toBe(false);
});
