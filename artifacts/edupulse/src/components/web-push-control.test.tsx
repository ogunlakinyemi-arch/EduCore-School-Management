// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
const state=vi.hoisted(()=>({configured:false,register:vi.fn(),revoke:vi.fn(),invalidate:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({
  useGetCommunicationPushConfiguration:()=>({data:{configured:state.configured,publicKey:state.configured?'YQ':null},isLoading:false,isError:false}),
  useRegisterCommunicationPushDevice:()=>({mutateAsync:state.register}),
  useRevokeCommunicationPushSession:()=>({mutateAsync:state.revoke}),
}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:state.invalidate})}));
import { WebPushControl } from './web-push-control';
let root: Root;
let container: HTMLDivElement;
function renderControl() {
  container=document.createElement('div');document.body.appendChild(container);
  root=createRoot(container);act(()=>root.render(<WebPushControl schoolId={1}/>));
}
function button(name:string) {
  return Array.from(container.querySelectorAll('button')).find(b=>b.textContent===name)!;
}
describe('browser push permission controls (mocked, no network)',()=>{
  beforeEach(()=>{
    state.configured=false;state.register.mockReset();state.revoke.mockReset().mockResolvedValue(undefined);
    state.invalidate.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{ready:Promise.resolve({pushManager:{getSubscription:async()=>null}})}});
    vi.stubGlobal('PushManager',class{});
    vi.stubGlobal('Notification',{requestPermission:vi.fn(async()=> 'denied')});
  });
  afterEach(()=>{act(()=>root?.unmount());container?.remove();vi.unstubAllGlobals();});
  it('missing VAPID configuration disables permission request and states the limitation',()=>{
    renderControl();
    expect(button('Enable on this device').disabled).toBe(true);
    expect(container.textContent).toContain('VAPID settings are not configured');
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });
  it('permission is requested only by user action and denial never registers a subscription',async()=>{
    state.configured=true;renderControl();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    await act(async()=>button('Enable on this device').click());
    expect(container.querySelector('[role="status"]')?.textContent).toContain('not permitted');
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(state.register).not.toHaveBeenCalled();
  });
  it('session revocation succeeds without inventing physical delivery',async()=>{
    renderControl();
    await act(async()=>button('Disable this session').click());
    expect(container.querySelector('[role="status"]')?.textContent).toContain('session are revoked');
    expect(state.revoke).toHaveBeenCalledTimes(1);
    expect(state.invalidate).toHaveBeenCalled();
  });
  it('revocation failures are explicit and do not say the session was revoked',async()=>{
    state.revoke.mockRejectedValue(new Error('test failure'));renderControl();
    await act(async()=>button('Disable this session').click());
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Could not revoke');
  });
});