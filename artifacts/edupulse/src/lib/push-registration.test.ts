import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const register=vi.hoisted(()=>vi.fn());
vi.mock('./pwa',()=>({registerPwaServiceWorker:register}));
import {readyPushWorker,decodePushKey} from './push-registration';
describe('push activation readiness (no permission or network)',()=>{
  beforeEach(()=>{
    vi.stubGlobal('window',{isSecureContext:true,PushManager:class{},Notification:{}});
    vi.stubGlobal('navigator',{serviceWorker:{}});
    register.mockReset();
  });
  afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
  it('waits on the registered worker activation, not the container ready promise',async()=>{
    const worker=Object.assign(new EventTarget(),{state:'installing'});
    const registration=Object.assign(new EventTarget(),{installing:worker,waiting:null,active:null});
    register.mockResolvedValue(registration);
    const ready=readyPushWorker();
    await Promise.resolve();
    worker.state='activated';worker.dispatchEvent(new Event('statechange'));
    expect(await ready).toBe(registration);
  });
  it('explains a rejected registration without returning raw browser errors',async()=>{
    register.mockRejectedValue(new Error('secret response data'));
    await expect(readyPushWorker()).rejects.toThrow('Could not register the push worker');
  });
  it('fails promptly on redundant installation and bounds a hung registration',async()=>{
    const worker=Object.assign(new EventTarget(),{state:'redundant'});
    register.mockResolvedValue(Object.assign(new EventTarget(),{installing:worker}));
    await expect(readyPushWorker()).rejects.toThrow('installation failed');
    vi.useFakeTimers();register.mockReturnValue(new Promise(()=>{}));
    const promise=expect(readyPushWorker()).rejects.toThrow('activation timed out');
    await vi.advanceTimersByTimeAsync(15000);await promise;
  });
  it('rejects a malformed VAPID public key',()=>{
    expect(()=>decodePushKey('YQ')).toThrow('Invalid VAPID');
  });
});
