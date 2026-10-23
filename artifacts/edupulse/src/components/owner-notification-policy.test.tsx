// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {beforeEach, afterEach, describe, expect, it, vi} from 'vitest';
import type {NotificationChannelPolicy} from '@workspace/api-client-react';

const mocks=vi.hoisted(()=>({
  directory:vi.fn(),policy:vi.fn(),save:vi.fn(),mutateAsync:vi.fn(),refetch:vi.fn(),retry:vi.fn(),
}));
vi.mock('@workspace/api-client-react',()=>({
  useListOwnerSchoolDirectory:mocks.directory,
  useGetNotificationChannelPolicy:mocks.policy,
  getGetNotificationChannelPolicyQueryKey:()=>['owner-policy'],
  useUpdateNotificationChannelPolicy:mocks.save,
}));
import {OwnerNotificationPolicyControl} from './owner-notification-policy';

let host:HTMLDivElement,root:Root,policy:NotificationChannelPolicy;
const schoolList=[{id:9,name:'North Academy'},{id:12,name:'South School'}];
function directory(overrides:Record<string,unknown>={}){
  mocks.directory.mockReturnValue({data:{schools:schoolList},isLoading:false,isError:false,isFetching:false,refetch:mocks.retry,...overrides});
}
async function render(){await act(async()=>root.render(<OwnerNotificationPolicyControl/>));}
const button=(text:string)=>[...host.querySelectorAll('button')].find(item=>item.textContent===text)!;
const select=()=>host.querySelector('select')!;
async function change(element:HTMLInputElement|HTMLSelectElement,value:string){
  await act(async()=>{
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),'value')!.set!.call(element,value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement?'change':'input',{bubbles:true}));
  });
}
async function click(element:HTMLElement){await act(async()=>element.click());}
beforeEach(()=>{
  vi.clearAllMocks();
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  policy={events:{FINANCE:{allowed:['IN_APP','EMAIL'],defaults:['IN_APP']},
    ATTENDANCE_ENTRY:{allowed:['IN_APP','SMS'],defaults:['IN_APP']}},schools:{'12':{enabled:false,allowed:['IN_APP']}}};
  mocks.policy.mockReturnValue({data:{policy,availability:{IN_APP:true,SMS:true,EMAIL:true,PUSH:false,TELEGRAM:false}},refetch:mocks.refetch});
  mocks.mutateAsync.mockResolvedValue({});
  mocks.save.mockReturnValue({isPending:false,mutateAsync:mocks.mutateAsync});
  directory();
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

describe('Owner school permission selector',()=>{
  it('shows configured Email as globally permitted with Default off and no real school required',async()=>{
    directory({data:{schools:[]}});
    policy.events.ACADEMIC={allowed:['IN_APP','EMAIL'],defaults:['IN_APP']};
    policy.events.ATTENDANCE_ABSENCE={allowed:['IN_APP','EMAIL'],defaults:['IN_APP']};
    mocks.policy.mockReturnValue({data:{policy,availability:{IN_APP:true,EMAIL:false,SMS:false,PUSH:false,TELEGRAM:false},
      readiness:{EMAIL:{configurationReady:true,deliveryReady:false,
        configurationDetail:'Email configuration passes local validation without a school tenant.',
        deliveryHold:'External delivery held by the launch safeguard.'}}},refetch:mocks.refetch});
    await render();
    for(const event of ['FINANCE','ACADEMIC','ATTENDANCE_ABSENCE']){
      const allowed=host.querySelector<HTMLInputElement>(`[aria-label="${event} EMAIL allowed"]`)!;
      const selected=host.querySelector<HTMLInputElement>(`[aria-label="${event} EMAIL default"]`)!;
      expect(allowed.checked).toBe(true);expect(selected.checked).toBe(false);
      const row=allowed.closest('label')!.parentElement!;
      expect(row.textContent).toContain('EMAIL — Globally permitted');
      expect(row.textContent).toContain('Not selected as a default — no automatic send');
      expect(row.textContent).toContain('Configured — delivery held by launch safeguard');
    }
    expect(host.textContent).toContain('No schools are available');
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
  it('shows per-channel configuration and launch holds without changing policy or enabling defaults',async()=>{
    const readiness=Object.fromEntries(['EMAIL','PUSH','TELEGRAM'].map(channel=>[channel,{
      configurationReady:channel!=='EMAIL',deliveryReady:false,
      configurationDetail:channel==='EMAIL'?'Owner setup required: COMMUNICATION_EMAIL_PROVIDER.':`${channel} configuration passes local validation.`,
      deliveryHold:'External delivery is held: EDUCORE_NOTIFICATION_LIVE_FROM is not set. Existing TEST history remains isolated.',
    }]));
    mocks.policy.mockReturnValue({data:{policy,availability:{IN_APP:true,SMS:false,EMAIL:false,PUSH:false,TELEGRAM:false},readiness},refetch:mocks.refetch});
    await render();
    expect(host.textContent).toContain('EMAIL: configuration not ready');
    expect(host.textContent).toContain('PUSH: configuration ready');
    expect(host.textContent).toContain('TELEGRAM: configuration ready');
    expect(host.textContent).toContain('EDUCORE_NOTIFICATION_LIVE_FROM is not set');
    expect(host.textContent).toContain('Existing TEST history remains isolated');
    expect(host.textContent).toContain('PUSH — Not globally permitted');
    expect(host.textContent).toContain('TELEGRAM — Not globally permitted');
    expect(host.textContent).toContain('Configured — delivery held by launch safeguard');
    expect(host.textContent).not.toContain('Permitted, not yet deliverable');
    expect((host.querySelector('[aria-label="FINANCE EMAIL default"]') as HTMLInputElement).disabled).toBe(true);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.policy).toHaveBeenCalledWith({query:{queryKey:['owner-policy'],refetchInterval:30000}});
  });
  it('uses the authenticated Owner directory and shows school names, requiring a selection',async()=>{
    await render();
    expect(mocks.directory).toHaveBeenCalledWith({status:'all'});
    expect([...select().options].map(item=>item.text)).toEqual(['Select a school','North Academy','South School']);
    expect(host.querySelector('input[type="number"]')).toBeNull();
    expect(button('Add override').disabled).toBe(true);
    expect(host.querySelectorAll('legend')[2].textContent).toBe('South School');
  });
  it('searches names, selects a school and saves the original override contract without changing global rules',async()=>{
    await render();
    await change(host.querySelector('input[type="search"]')!,'north');
    expect([...select().options].map(item=>item.text)).toEqual(['Select a school','North Academy']);
    expect(button('Add override').disabled).toBe(true);
    await change(select(),'9');expect(button('Add override').disabled).toBe(false);
    await click(button('Add override'));
    expect(host.textContent).toContain('North Academy');
    expect(select().value).toBe('');expect(button('Add override').disabled).toBe(true);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    await click(button('Save Owner policy'));
    const saved=mocks.mutateAsync.mock.calls[0][0].data;
    expect(saved.events).toEqual(policy.events);
    expect(saved.events.FINANCE.allowed).not.toContain('SMS');
    expect(saved.schools['9']).toEqual({enabled:true,allowed:['IN_APP','EMAIL']});
    expect(saved.schools['12']).toEqual(policy.schools['12']);
    expect(policy.schools['9']).toBeUndefined();
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
  it('clears the selection when searching again and explains no matches',async()=>{
    await render();await change(select(),'9');
    await change(host.querySelector('input[type="search"]')!,'missing');
    expect(select().value).toBe('');expect(button('Add override').disabled).toBe(true);
    expect(host.textContent).toContain('No schools match your search.');
  });
  it('distinguishes duplicate names without making raw identifiers the primary label',async()=>{
    directory({data:{schools:[{id:9,name:'Academy'},{id:12,name:'Academy'}]}});
    await render();
    expect([...select().options].slice(1).map(item=>item.text)).toEqual(['Academy (reference #9)','Academy (reference #12)']);
  });
  it('disables selection while loading and handles an empty directory',async()=>{
    directory({isLoading:true,data:undefined});await render();
    expect(host.textContent).toContain('Loading schools');expect(select().disabled).toBe(true);
    expect(button('Add override').disabled).toBe(true);
    directory({data:{schools:[]}});await render();
    expect(host.textContent).toContain('No schools are available');
    expect(button('Add override').disabled).toBe(true);
  });
  it('fails closed on directory errors even with stale data and allows retry',async()=>{
    await render();await change(select(),'9');
    directory({isError:true});await render();
    expect(host.textContent).toContain('Could not load schools');
    expect(select().disabled).toBe(true);expect(button('Add override').disabled).toBe(true);
    await click(button('Retry school list'));expect(mocks.retry).toHaveBeenCalledOnce();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
  it('rejects a removed selection after directory refresh, without discarding existing overrides',async()=>{
    await render();await change(select(),'9');
    directory({data:{schools:[]}});await render();
    expect(select().value).toBe('');expect(button('Add override').disabled).toBe(true);
    expect(host.textContent).toContain('School not in current directory (reference #12)');
    expect(button('Save Owner policy').disabled).toBe(true);
  });
  it('keeps SMS disabled in new overrides without modifying historical global permissions',async()=>{
    await render();await change(select(),'9');await click(button('Add override'));
    const override=[...host.querySelectorAll('fieldset')].find(item=>item.querySelector('legend')?.textContent==='North Academy')!;
    const sms=[...override.querySelectorAll('label')].find(item=>item.textContent==='SMS')!.querySelector('input')!;
    expect(sms.disabled).toBe(true);
    expect(sms.checked).toBe(false);
    await click(sms);
    expect((override.querySelectorAll('input')[5] as HTMLInputElement).disabled).toBe(true);
    await click(button('Save Owner policy'));
    const saved=mocks.mutateAsync.mock.calls[0][0].data;
    expect(saved.schools['9'].allowed).not.toContain('SMS');
    expect(saved.events).toEqual(policy.events);
    await click(button('Use global permissions'));
    await click(button('Save Owner policy'));
    expect(mocks.mutateAsync.mock.calls[1][0].data.schools).toEqual({});
    expect(mocks.mutateAsync.mock.calls[1][0].data.events).toEqual(policy.events);
  });
  it('permits Telegram while unavailable but keeps it out of defaults until delivery is ready',async()=>{
    await render();
    const telegramAllowed=host.querySelector<HTMLInputElement>('input[aria-label="FINANCE TELEGRAM allowed"]')!;
    const telegramDefault=host.querySelector<HTMLInputElement>('input[aria-label="FINANCE TELEGRAM default"]')!;
    expect(telegramAllowed.disabled).toBe(false);
    expect(telegramDefault.disabled).toBe(true);
    expect(host.textContent).toContain('TELEGRAM — Not globally permitted');
    expect(host.textContent).toContain('Readiness details unavailable');

    await click(telegramAllowed);
    expect(telegramAllowed.checked).toBe(true);
    expect(telegramDefault.disabled).toBe(true);
    expect(host.textContent).toContain('TELEGRAM — Globally permitted');
    expect(host.textContent).toContain('Readiness details unavailable');

    await change(select(),'9');
    await click(button('Add override'));
    const override=[...host.querySelectorAll('fieldset')].find(item=>item.querySelector('legend')?.textContent==='North Academy')!;
    const schoolTelegram=override.querySelector<HTMLInputElement>('input[aria-label="School 9 TELEGRAM permitted"]')!;
    expect(schoolTelegram.disabled).toBe(false);
    expect(schoolTelegram.checked).toBe(true);
    await click(button('Save Owner policy'));
    const saved=mocks.mutateAsync.mock.calls[0][0].data;
    expect(saved.events.FINANCE.allowed).toContain('TELEGRAM');
    expect(saved.events.FINANCE.defaults).not.toContain('TELEGRAM');
    expect(saved.schools['9'].allowed).toContain('TELEGRAM');
  });
});
