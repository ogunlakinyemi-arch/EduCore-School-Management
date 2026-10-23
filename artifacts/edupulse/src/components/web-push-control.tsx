import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetCommunicationPushConfiguration, useRegisterCommunicationPushDevice, useRevokeCommunicationPushSession } from '@workspace/api-client-react';
import { readyPushWorker, decodePushKey, samePushKey, pushSupportProblem, PushSetupError } from '@/lib/push-registration';
import { notificationErrorClass } from './notification-errors';

export function WebPushControl({ schoolId }: { schoolId: number | null }) {
  const configuration = useGetCommunicationPushConfiguration();
  const cache = useQueryClient();
  const register = useRegisterCommunicationPushDevice();
  const revoke = useRevokeCommunicationPushSession();
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setMessage(''); setBusy(false);
    return () => { generation.current++; }; }, [schoolId]);
  const supportProblem = typeof window === 'undefined' ? 'Push requires a browser.' : pushSupportProblem();
  const supported = !supportProblem;
  const enable = async () => {
    const current = generation.current;
    setBusy(true); setMessage(''); setFailed(false);
    let stage = 'permission';
    try {
      if (!supported) throw new PushSetupError(supportProblem);
      if (!configuration.data?.configured || !configuration.data.publicKey)
        throw new PushSetupError('Push is not configured on the server. Ask the Owner to review the VAPID public/private key pair and subject; the inbox still works.');
      const publicKey = configuration.data.publicKey;
      let bytes: Uint8Array<ArrayBuffer>;
      try { bytes = decodePushKey(publicKey); }
      catch { throw new PushSetupError('The server push public key is invalid. Ask the Owner to review the VAPID configuration.'); }
      if (Notification.permission === 'denied')
        throw new PushSetupError('Notifications are blocked for EduCore. Allow them in this browser’s site settings, then retry. The inbox still works.');
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') throw new PushSetupError('Notification permission was not granted. Enable it in this browser’s site settings when ready; the inbox still works.');
      if (current !== generation.current) return;
      stage = 'worker';
      const worker = await readyPushWorker();
      if (current !== generation.current) return;
      stage = 'subscription';
      let existing = await worker.pushManager.getSubscription();
      if (current !== generation.current) return;
      if (existing && ((existing.expirationTime != null && existing.expirationTime <= Date.now())
          || !samePushKey(existing.options.applicationServerKey, bytes))) {
        if (!await existing.unsubscribe()) throw new PushSetupError('The old subscription could not be removed. Check browser notification settings.');
        existing = null;
      }
      if (current !== generation.current) return;
      const subscription = existing ?? await worker.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: bytes,
      });
      const serialized = subscription.toJSON();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint));
      const reference = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (!serialized.keys?.p256dh || !serialized.keys.auth) throw new PushSetupError('The browser returned an incomplete subscription. Retry in a full browser tab.');
      if (current !== generation.current) return;
      stage = 'server';
      await register.mutateAsync({ data: { schoolId, opaqueDeviceReference: reference, subscription: {
        endpoint: subscription.endpoint, expirationTime: serialized.expirationTime ?? null,
        keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth },
      } } });
      await cache.invalidateQueries({ queryKey: ['/api/communication/push-devices'] });
      if (current === generation.current) setMessage('This device is subscribed. Registration does not prove physical delivery.');
    } catch (error) {
      if (current === generation.current) {
        setFailed(true);
        const status = (error as { status?: number } | null)?.status;
        setMessage(error instanceof PushSetupError ? error.message :
          stage === 'server' ? status === 401 ? 'Your session expired. Sign in again to save this device.'
            : status === 403 ? 'This session cannot register push here. Ask the Owner to review your access.'
            : status === 429 ? 'Too many device registrations. Wait a minute and retry.'
            : 'The server could not save this push device. Retry later; ask the Owner to check push storage and VAPID configuration. Subscription delivery is not confirmed.'
          : stage === 'worker' ? 'The push worker could not start. Reload in a full browser tab and retry.'
          : stage === 'permission' ? 'The browser could not request permission. Open EduCore directly in a full browser tab and review site notification settings.'
          : 'The browser push service rejected registration. Check site notification permissions and connectivity; ask the Owner to verify the VAPID key pair if it persists.');
      }
    }
    finally { if (current === generation.current) setBusy(false); }
  };
  const disable = async () => {
    const current = generation.current;
    setBusy(true); setFailed(false); setMessage('');
    try {
      await revoke.mutateAsync();
      await cache.invalidateQueries({ queryKey: ['/api/communication/push-devices'] });
      let browserRemoved = true;
      try {
        const worker = supported ? await navigator.serviceWorker.getRegistration?.(import.meta.env.BASE_URL) : null;
        const subscription = worker ? await worker.pushManager.getSubscription() : null;
        if (subscription) browserRemoved = await subscription.unsubscribe();
      } catch { browserRemoved = false; }
      if (current === generation.current) { setFailed(!browserRemoved); setMessage(browserRemoved
        ? 'Push devices for this session are revoked. In-app messages remain available.'
        : 'This session is revoked on the server. The browser subscription could not be removed; check browser notification settings.'); }
    } catch { if (current === generation.current) { setFailed(true); setMessage('Could not revoke this session. Try again before signing out.'); } }
    finally { if (current === generation.current) setBusy(false); }
  };
  return <section className="rounded-xl border border-[hsl(var(--border))] p-4 space-y-3" aria-label="Browser push notifications">
    <h3 className="font-bold">Browser push notifications</h3>
    <p role={!supported || configuration.isError || (!configuration.isLoading && !configuration.data?.configured) ? 'alert' : 'status'}
      className={!supported || configuration.isError || (!configuration.isLoading && !configuration.data?.configured) ? notificationErrorClass : 'text-sm'}>
      {!supported ? supportProblem : configuration.isLoading ? 'Checking push configuration…' :
      configuration.isError ? 'Could not check server push configuration. Check your connection and session, then retry.' : configuration.data?.configured ? 'Permission is requested only when you choose Enable.' :
        'Push VAPID settings are not configured on the server. Ask the Owner to review the key pair and subject. The inbox still works.'}</p>
    {configuration.isError && <button type="button" className="min-h-11 underline" onClick={() => void configuration.refetch()}>Retry configuration check</button>}
    <div className="flex flex-wrap gap-3">
      <button type="button" className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={busy || !supported || !configuration.data?.configured} onClick={() => void enable()}>Enable on this device</button>
      <button type="button" className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={busy} onClick={() => void disable()}>Disable this session</button>
    </div>
    {configuration.data?.configured && configuration.data.deliveryEnabled === false &&
      <p className="text-sm">{configuration.data.launchHeld
        ? 'Device setup is enabled. Sending is held until the Owner approves the notification launch cutoff; subscribing does not release queued notifications.'
        : 'Subscriptions can be saved, but sending to this user is restricted in this environment.'}</p>}
    {message && <p role={failed ? 'alert' : 'status'} className={failed ? notificationErrorClass : 'text-sm break-words'}>{message}</p>}
    <p className="text-xs text-[hsl(var(--muted-foreground))]">Push contains a generic notice only. Open the authenticated app for details. Expired or logged-out sessions cannot receive new sends.</p>
  </section>;
}