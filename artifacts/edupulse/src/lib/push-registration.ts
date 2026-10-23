import { registerPwaServiceWorker } from "./pwa";

export class PushSetupError extends Error {}
export function pushSupportProblem() {
  if (!window.isSecureContext) return 'Push requires HTTPS. Open the secure EduCore address in a full browser tab.';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'This browser does not support push. Use a supported browser; on iPhone/iPad, add EduCore to the Home Screen and open it there.';
  return '';
}
export async function readyPushWorker() {
  const problem = pushSupportProblem();
  if (problem) throw new PushSetupError(problem);
  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const cleanups: (() => void)[] = [];
    let settled = false;
    const finish = (error?: PushSetupError, registration?: ServiceWorkerRegistration) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); cleanups.forEach(cleanup => cleanup());
      error ? reject(error) : resolve(registration!);
    };
    const timer = setTimeout(() => finish(new PushSetupError(
      'Push worker activation timed out. Open EduCore in a full browser tab, reload once, and retry. If it persists, ask the Owner to check service-worker installation and site storage.')), 15_000);
    void registerPwaServiceWorker(import.meta.env.BASE_URL).then(registration => {
      if (settled) return;
      if (!registration) return finish(new PushSetupError('Push needs a secure, supported browser. Open EduCore over HTTPS in a full tab.'));
      if (registration.active?.state === 'activated') return finish(undefined, registration);
      const observed = new Set<ServiceWorker>();
      const observe = () => {
        if (registration.active?.state === 'activated') return finish(undefined, registration);
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        if (!worker || observed.has(worker)) return;
        observed.add(worker);
        const changed = () => {
          if (worker.state === 'activated') finish(undefined, registration);
          else if (worker.state === 'redundant') finish(new PushSetupError(
            'Push worker installation failed. Reload once; if it persists, ask the Owner to check the service-worker script and browser storage. No subscription was saved.'));
        };
        worker.addEventListener('statechange', changed);
        cleanups.push(() => worker.removeEventListener('statechange', changed));
        changed();
      };
      registration.addEventListener('updatefound', observe);
      cleanups.push(() => registration.removeEventListener('updatefound', observe));
      observe();
    }).catch(() => finish(new PushSetupError(
      'Could not register the push worker. Open EduCore over HTTPS in a full tab and allow site storage. Ask the Owner to check that service-worker.js is served as JavaScript at the app address.')));
  });
}

export function decodePushKey(key: string) {
  const bytes = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new PushSetupError('Invalid VAPID public key.');
  return bytes;
}
export function samePushKey(existing: ArrayBuffer | null | undefined, expected: Uint8Array) {
  if (!existing) return false;
  const bytes = new Uint8Array(existing);
  return bytes.length === expected.length && bytes.every((v, i) => v === expected[i]);
}
