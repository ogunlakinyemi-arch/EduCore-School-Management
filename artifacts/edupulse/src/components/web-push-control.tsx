import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetCommunicationPushConfiguration, useRegisterCommunicationPushDevice, useRevokeCommunicationPushSession } from '@workspace/api-client-react';

export function WebPushControl({ schoolId }: { schoolId: number | null }) {
  const configuration = useGetCommunicationPushConfiguration();
  const cache = useQueryClient();
  const register = useRegisterCommunicationPushDevice();
  const revoke = useRevokeCommunicationPushSession();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const enable = async () => {
    setBusy(true); setMessage('');
    try {
      if (!supported || !configuration.data?.publicKey) throw new Error('Web Push is not configured or supported.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications were not permitted. You can still use the EduCore inbox.');
      const worker = await navigator.serviceWorker.ready;
      const publicKey = configuration.data.publicKey;
      const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const subscription = await worker.pushManager.getSubscription() ?? await worker.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: bytes,
      });
      const serialized = subscription.toJSON();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint));
      const reference = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (!serialized.keys?.p256dh || !serialized.keys.auth) throw new Error('The browser returned an incomplete subscription.');
      await register.mutateAsync({ data: { schoolId, opaqueDeviceReference: reference, subscription: {
        endpoint: subscription.endpoint, expirationTime: serialized.expirationTime ?? null,
        keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth },
      } } });
      await cache.invalidateQueries({ queryKey: ['/api/communication/push-devices'] });
      setMessage('This device is subscribed. Registration does not prove physical delivery.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not register this device.'); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try {
      await revoke.mutateAsync();
      await cache.invalidateQueries({ queryKey: ['/api/communication/push-devices'] });
      if (supported) await (await navigator.serviceWorker.ready).pushManager.getSubscription().then(s => s?.unsubscribe());
      setMessage('Push devices for this session are revoked. In-app messages remain available.');
    } catch { setMessage('Could not revoke this session. Try again before signing out.'); }
    finally { setBusy(false); }
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
    {message && <p role="status" className="text-sm break-words">{message}</p>}
    <p className="text-xs text-[hsl(var(--muted-foreground))]">Push contains a generic notice only. Open the authenticated app for details. Expired or logged-out sessions cannot receive new sends.</p>
  </section>;
}