import { registerPwaServiceWorker } from "./pwa";

export async function readyPushWorker() {
  const registration = await registerPwaServiceWorker(import.meta.env.BASE_URL);
  if (!registration) throw new Error("A secure, active EduCore service worker is required for push.");
  if (registration.active) return registration;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timer = setTimeout(() =>
        reject(new Error("The service worker is not ready. Reload EduCore and try again.")), 15_000); }),
    ]);
    if (ready.scope !== registration.scope) throw new Error("The EduCore service worker scope does not match.");
    return ready;
  } finally { clearTimeout(timer); }
}

export function decodePushKey(key: string) {
  return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}
export function samePushKey(existing: ArrayBuffer | null | undefined, expected: Uint8Array) {
  if (!existing) return false;
  const bytes = new Uint8Array(existing);
  return bytes.length === expected.length && bytes.every((v, i) => v === expected[i]);
}
