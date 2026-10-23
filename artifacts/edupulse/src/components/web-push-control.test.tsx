// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
const state=vi.hoisted(()=>({configured:false,register:vi.fn(),revoke:vi.fn(),invalidate:vi.fn(),worker:null as any,
  launchHeld:false,deliveryEnabled:true,
  publicKey: btoa(String.fromCharCode(4,...Array(64).fill(97)))}));
vi.mock('@/lib/push-registration',async original=>({
  ...await original<typeof import('@/lib/push-registration')>(),
  readyPushWorker:async()=>{if(state.worker instanceof Error)throw state.worker;return state.worker;},
}));
vi.mock('@workspace/api-client-react',()=>({
  useGetCommunicationPushConfiguration:()=>({data:{configured:state.configured,publicKey:state.configured?state.publicKey:null,
    launchHeld:state.launchHeld,deliveryEnabled:state.deliveryEnabled},isLoading:false,isError:false}),
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
    state.launchHeld=false;state.deliveryEnabled=true;
    state.invalidate.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    vi.stubGlobal('isSecureContext',true);
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{ready:Promise.resolve({pushManager:{getSubscription:async()=>null}})}});
    vi.stubGlobal('PushManager',class{});
    vi.stubGlobal('Notification',{requestPermission:vi.fn(async()=> 'denied')});
    vi.stubGlobal('crypto',{subtle:{digest:vi.fn(async()=>new Uint8Array(32).buffer)}});
    state.worker=null;
  });
  afterEach(()=>{act(()=>root?.unmount());container?.remove();vi.unstubAllGlobals();});
  it('missing VAPID configuration disables permission request and states the limitation',()=>{
    renderControl();
    expect(button('Enable on this device').disabled).toBe(true);
    expect(container.textContent).toContain('VAPID settings are not configured');
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });
  it('keeps device setup enabled during the Production launch hold without claiming delivery or requesting permission automatically',()=>{
    state.configured=true;state.launchHeld=true;state.deliveryEnabled=false;
    renderControl();
    expect(button('Enable on this device').disabled).toBe(false);
    expect(container.textContent).toContain('Sending is held');
    expect(container.textContent).not.toContain('disabled in Development');
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
  });
  it('permission is requested only by user action and denial never registers a subscription',async()=>{
    state.configured=true;renderControl();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    await act(async()=>button('Enable on this device').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not granted');
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
    expect(Array.from(container.querySelectorAll('[role="alert"]')).some(p=>p.textContent?.includes('Could not revoke'))).toBe(true);
  });
  it('registers a real PushManager-shaped subscription only after user permission, with school association',async()=>{
    state.configured=true;
    vi.mocked(Notification.requestPermission).mockResolvedValue('granted');
    const subscription={endpoint:'https://fcm.googleapis.com/synthetic',expirationTime:null,
      options:{applicationServerKey:new Uint8Array([4,...Array(64).fill(97)]).buffer},
      toJSON:()=>({keys:{p256dh:'synthetic-public-key',auth:'synthetic-auth'}})};
    const subscribe=vi.fn(async()=>subscription);
    state.worker={pushManager:{getSubscription:async()=>null,subscribe}};
    renderControl();
    expect(subscribe).not.toHaveBeenCalled();
    await act(async()=>button('Enable on this device').click());
    expect(subscribe).toHaveBeenCalledWith({userVisibleOnly:true,applicationServerKey:new Uint8Array([4,...Array(64).fill(97)])});
    expect(state.register).toHaveBeenCalledWith({data:expect.objectContaining({
      schoolId:1,subscription:{endpoint:subscription.endpoint,expirationTime:null,
        keys:{p256dh:'synthetic-public-key',auth:'synthetic-auth'}},
    })});
    expect(container.textContent).toContain('Registration does not prove physical delivery');
  });
  it('replaces an expired or old-key browser subscription before associating it with this session',async()=>{
    state.configured=true;vi.mocked(Notification.requestPermission).mockResolvedValue('granted');
    const unsubscribe=vi.fn(async()=>true);
    const subscribe=vi.fn(async()=>({endpoint:'https://fcm.googleapis.com/replacement',
      toJSON:()=>({keys:{p256dh:'synthetic-public-key',auth:'synthetic-auth'}})}));
    state.worker={pushManager:{getSubscription:async()=>({expirationTime:Date.now()-1,
      options:{applicationServerKey:new Uint8Array([98]).buffer},unsubscribe}),subscribe}};
    renderControl();await act(async()=>button('Enable on this device').click());
    expect(unsubscribe).toHaveBeenCalledTimes(1);expect(subscribe).toHaveBeenCalledTimes(1);
    expect(state.register).toHaveBeenCalledTimes(1);
  });
  it('reports persistence failure without claiming subscription success',async()=>{
    state.configured=true;vi.mocked(Notification.requestPermission).mockResolvedValue('granted');
    state.worker={pushManager:{getSubscription:async()=>({endpoint:'https://fcm.googleapis.com/synthetic',
      expirationTime:null,options:{applicationServerKey:new Uint8Array([4,...Array(64).fill(97)]).buffer},
      toJSON:()=>({keys:{p256dh:'synthetic-public-key',auth:'synthetic-auth'}})})}};
    state.register.mockRejectedValue(new Error('Synthetic storage failure'));
    renderControl();await act(async()=>button('Enable on this device').click());
    expect(container.textContent).toContain('server could not save');
    expect(container.textContent).not.toContain('Synthetic storage failure');
    expect(container.querySelector('[role="alert"]')?.className).toContain('text-[#991b1b]');
    expect(container.textContent).not.toContain('This device is subscribed');
  });
  it('shows worker failures as red alerts without exposing unexpected browser error data',async()=>{
    state.configured=true;state.worker=new Error('sensitive browser details');
    vi.mocked(Notification.requestPermission).mockResolvedValue('granted');
    renderControl();await act(async()=>button('Enable on this device').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('worker could not start');
    expect(container.textContent).not.toContain('sensitive browser details');
    expect(state.register).not.toHaveBeenCalled();
  });
  it('explains unsupported/insecure contexts without requesting permission',()=>{
    vi.stubGlobal('isSecureContext',false);
    renderControl();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('HTTPS');
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(button('Enable on this device').disabled).toBe(true);
  });
});