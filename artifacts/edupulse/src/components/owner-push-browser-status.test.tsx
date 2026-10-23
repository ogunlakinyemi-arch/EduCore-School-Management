// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const support=vi.hoisted(()=>({problem:''}));
vi.mock('@/lib/push-registration',()=>({pushSupportProblem:()=>support.problem}));
import {inspectOwnerPushBrowser} from './owner-push-browser-status';
const permissionRequest=vi.fn(),register=vi.fn(),subscribe=vi.fn(),getKey=vi.fn(),unsubscribe=vi.fn();
const getSubscription=vi.fn(),getRegistration=vi.fn();
beforeEach(()=>{
  vi.clearAllMocks();support.problem='';
  vi.stubGlobal('Notification',{permission:'granted',requestPermission:permissionRequest});
  vi.stubGlobal('navigator',{serviceWorker:{getRegistration,register}});
  getSubscription.mockResolvedValue(null);
  getRegistration.mockResolvedValue({active:{},pushManager:{getSubscription,subscribe}});
});
afterEach(()=>{
  expect(permissionRequest).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  expect(getKey).not.toHaveBeenCalled();
  expect(unsubscribe).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
describe('Owner local Push blockers without requesting or altering setup',()=>{
  it('reports unsupported browsers without reading a subscription',async()=>{
    support.problem='This browser does not support push.';
    expect(await inspectOwnerPushBrowser()).toContain('does not support push');
    expect(getRegistration).not.toHaveBeenCalled();
  });
  it.each(['denied','default'])('reports %s permission without prompting',async permission=>{
    vi.stubGlobal('Notification',{permission,requestPermission:permissionRequest});
    expect(await inspectOwnerPushBrowser()).toContain(permission==='denied'?'blocked':'has not been granted');
    expect(getRegistration).not.toHaveBeenCalled();
  });
  it('reports missing and inactive workers precisely',async()=>{
    getRegistration.mockResolvedValueOnce(null).mockResolvedValueOnce({active:null});
    expect(await inspectOwnerPushBrowser()).toContain('No EduCore service worker');
    expect(await inspectOwnerPushBrowser()).toContain('not active');
    expect(getSubscription).not.toHaveBeenCalled();
  });
  it('distinguishes absent from present subscriptions without reading endpoint or key material',async()=>{
    expect(await inspectOwnerPushBrowser()).toContain('has no Push subscription');
    getSubscription.mockResolvedValue({getKey,unsubscribe,
      get endpoint(){throw new Error('Endpoint must not be read');},
      toJSON(){throw new Error('Subscription must not be serialized');}});
    expect(await inspectOwnerPushBrowser()).toContain('A local Push subscription exists');
    expect(await inspectOwnerPushBrowser()).toContain('server/session registration');
  });
  it('reports subscription-inspection errors without echoing the exception',async()=>{
    getSubscription.mockRejectedValue(new Error('synthetic-private-detail'));
    const result=await inspectOwnerPushBrowser();
    expect(result).toContain('could not read');
    expect(result).not.toContain('synthetic-private-detail');
  });
});
