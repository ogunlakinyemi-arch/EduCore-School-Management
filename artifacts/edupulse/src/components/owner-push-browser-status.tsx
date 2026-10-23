import {useEffect,useState} from 'react';
import {pushSupportProblem} from '@/lib/push-registration';

/** Read local status only: no permissions, registration, key reads or server calls. */
export async function inspectOwnerPushBrowser():Promise<string>{
  const unsupported=pushSupportProblem();
  if(unsupported)return unsupported;
  if(Notification.permission==='denied')return 'Notifications are blocked in this browser’s site settings.';
  if(Notification.permission!=='granted')return 'Notification permission has not been granted in this browser. No permission was requested.';
  try{
    const registration=await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    if(!registration)return 'No EduCore service worker is registered for this browser.';
    if(!registration.active)return 'The EduCore service worker is not active yet.';
    if(!await registration.pushManager.getSubscription())return 'This browser has no Push subscription. Enable it through the existing device setup when authorized.';
    return 'A local Push subscription exists. Current server/session registration and recipient delivery are not verified by this read-only check.';
  }catch{
    return 'This browser could not read its existing Push subscription. Check browser support and site settings; no subscription was changed.';
  }
}

export function OwnerPushBrowserStatus(){
  const [revision,setRevision]=useState(0);
  const [status,setStatus]=useState('Checking this browser without requesting permission…');
  useEffect(()=>{
    let active=true;
    void inspectOwnerPushBrowser().then(value=>{if(active)setStatus(value);});
    return ()=>{active=false;};
  },[revision]);
  useEffect(()=>{
    const refresh=()=>setRevision(value=>value+1);
    window.addEventListener('focus',refresh);
    return ()=>window.removeEventListener('focus',refresh);
  },[]);
  return <div className="text-sm" data-testid="owner-push-browser-status">
    <p>This browser only: {status}</p>
    <p>This device’s status does not block other recipients or prove a school-wide subscription.</p>
    <button type="button" className="min-h-10 underline" onClick={()=>setRevision(value=>value+1)}>Refresh browser status</button>
  </div>;
}
