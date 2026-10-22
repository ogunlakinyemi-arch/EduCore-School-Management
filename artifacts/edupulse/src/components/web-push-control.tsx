import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetCommunicationPushConfiguration, useRegisterCommunicationPushDevice, useRevokeCommunicationPushSession } from '@workspace/api-client-react';
import { readyPushWorker, decodePushKey, samePushKey } from '@/lib/push-registration';

export function WebPushControl({ schoolId }: { schoolId: number | null }) {
  const configuration = useGetCommunicationPushConfiguration();
  const cache = useQueryClient();
  const register = useRegisterCommunicationPushDevice();
  const revoke = useRevokeCommunicationPushSession();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setMessage(''); setBusy(false);
    return () => { generation.current++; }; }, [schoolId]);
  const supported = typeof window !== 'undefined' && window.isSecureContext !== false
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const enable = async () => {
    const current = generation.current;
    setBusy(true); setMessage('');
    try {
      if (!supported || !configuration.data?.publicKey) throw new Error('Web Push is not configured or supported.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications were not permitted. You can still use the EduCore inbox.');
      const worker = await readyPushWorker();
      const publicKey = configuration.data.publicKey;
      const bytes = decodePushKey(publicKey);
      let existing = await worker.pushManager.getSubscription();
      if (existing && ((existing.expirationTime != null && existing.expirationTime <= Date.now())
          || !samePushKey(existing.options.applicationServerKey, bytes))) {
        if (!await existing.unsubscribe()) throw new Error('The old subscription could not be removed. Check browser notification settings.');
        existing = null;
      }
      if (current !== generation.current) return;
      const subscription = existing ?? await worker.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: bytes,
      });
      const serialized = subscription.toJSON();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint));
      const reference = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (!serialized.keys?.p256dh || !serialized.keys.auth) throw new Error('The browser returned an incomplete subscription.');
      if (current !== generation.current) return;
      await register.mutateAsync({ data: { schoolId, opaqueDeviceReference: reference, subscription: {
        endpoint: subscription.endpoint, expirationTime: serialized.expirationTime ?? null,
        keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth },
      } } });
      await cache.invalidateQueries({ queryKey: ['/api/communication/push-devices'] });
      if (current === generation.current) setMessage('This device is subscribed. Registration does not prove physical delivery.');
    } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : 'Could not register this device.'); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const disable = async () => {
    const current = generation.current;
    setBusy(true);
    try {
      await revoke.mutateAsync();
      await cache.invalidateQueries({ queryKey: ['/api/communication/push-devices'] });
      let browserRemoved = true;
      try {
        const worker = supported ? await navigator.serviceWorker.getRegistration?.(import.meta.env.BASE_URL) : null;
        const subscription = worker ? await worker.pushManager.getSubscription() : null;
        if (subscription) browserRemoved = await subscription.unsubscribe();
      } catch { browserRemoved = false; }
      if (current === generation.current) setMessage(browserRemoved
        ? 'Push devices for this session are revoked. In-app messages remain available.'
        : 'This session is revoked on the server. The browser subscription could not be removed; check browser notification settings.');
    } catch { if (current === generation.current) setMessage('Could not revoke this session. Try again before signing out.'); }
    finally { if (current === generation.current) setBusy(false); }
  };
  return <section className="rounded-xl border border-[hsl(var(--border))] p-4 space-y-3" aria-label="Browser push notifications">
    <h3 className="font-bold">Browser push notifications</h3>
    <p className="text-sm">{!supported ? 'This browser does not support Web Push.' : configuration.isLoading ? 'Checking push configuration…' :
      configuration.isError ? 'Could not check push configuration.' : configuration.data?.configured ? 'Permission is requested only when you choose Enable.' :
        'VAPID settings are not configured. No push messages can be sent.'}</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={busy || !supported || !configuration.data?.configured} onClick={() => void enable()}>Enable on this device</button>
      <button type="button" className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={busy} onClick={() => void disable()}>Disable this session</button>
    </div>
    {configuration.data?.configured && configuration.data.deliveryEnabled === false &&
      <p className="text-sm">Subscriptions can be saved, but sending to this user is disabled in Development.</p>}
    {message && <p role="status" className="text-sm break-words">{message}</p>}
    <p className="text-xs text-[hsl(var(--muted-foreground))]">Push contains a generic notice only. Open the authenticated app for details. Expired or logged-out sessions cannot receive new sends.</p>
  </section>;
}