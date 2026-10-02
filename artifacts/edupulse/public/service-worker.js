/* EduCore only stores checked public static assets and its generic offline shell. */
const CACHE_PREFIX = 'educore-safe-static-';
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const MAX_STATIC_ENTRIES = 80;
const OFFLINE_FILE = 'offline.html';
const SAFE_ICON_FILES = [
  'favicon.svg',
  'icons/educore-192.png',
  'icons/educore-512.png',
  'icons/educore-maskable-512.png',
];

function scopedUrl(relativePath) {
  return new URL(relativePath, self.registration.scope).href;
}

function isDevPath(pathname) {
  return /^\/(?:src|@fs|@vite)(?:\/|$)/.test(pathname) ||
    /^\/(?:@id|@react-refresh|node_modules|__vite_ping)(?:\/|$)/.test(pathname);
}

function isSensitivePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  return /(?:^|\/)(?:api|auth|auth-callback|callback|clerk|__clerk|invitation|invitations|login|logout|oauth|private-objects?|privateobjects|private_objects|register|reset-password|sessions?|sign[_-]?in|sign[_-]?up|sso-callback|uploads?)(?:\/|$)/i.test(decoded);
}

function hasUnsafeVary(vary) {
  return vary.split(',').some((header) => {
    const normalized = header.trim().toLowerCase();
    // The Development proxy adds Vary: Origin for CORS. These paths are
    // checked same-origin public files, not authenticated responses.
    return normalized !== '' && normalized !== 'accept-encoding' && normalized !== 'origin';
  });
}

function isScopedSameOrigin(url) {
  const scope = new URL(self.registration.scope);
  return url.origin === self.location.origin && url.pathname.startsWith(scope.pathname);
}

function isVersionedAsset(pathname, basePath) {
  if (isSensitivePath(pathname)) return false;
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  if (!pathname.startsWith(`${base}assets/`)) return false;
  return /-[a-f0-9]{8,}\.(?:css|js|mjs|otf|ttf|woff|woff2)$/i.test(pathname);
}

function isCacheableStaticResponse(response, pathname, basePath) {
  if (!response || response.status !== 200 || response.type !== 'basic' || response.redirected) return false;
  const cacheControl = response.headers.get('Cache-Control') || '';
  const vary = response.headers.get('Vary') || '';
  if (/\b(?:private|no-store)\b/i.test(cacheControl) || hasUnsafeVary(vary)) return false;
  if (!isVersionedAsset(pathname, basePath)) return false;
  const contentType = response.headers.get('Content-Type') || '';
  return /^(?:text\/css|(?:text|application)\/javascript|font\/(?:woff2?|ttf|otf))(?:\s*;|$)/i.test(contentType.trim());
}

async function cacheCheckedAsset(request, cache, basePath) {
  try {
    const response = await fetch(request);
    const url = new URL(request.url);
    if (isCacheableStaticResponse(response, url.pathname, basePath)) {
      await cache.put(request, response.clone());
      await trimStaticCache(cache);
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('EduCore static resource unavailable.');
  }
}

async function trimStaticCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_STATIC_ENTRIES) return;
  const overflow = keys.length - MAX_STATIC_ENTRIES;
  await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
}

async function cachePublicShell(cache, relativePath, allowedType, expectedContent) {
  const url = scopedUrl(relativePath);
  const response = await fetch(url, { credentials: 'omit', cache: 'no-cache' });
  if (
    response.status !== 200 ||
    response.type !== 'basic' ||
    response.redirected ||
    /\b(?:private|no-store)\b/i.test(response.headers.get('Cache-Control') || '') ||
    hasUnsafeVary(response.headers.get('Vary') || '') ||
    !(allowedType.test(response.headers.get('Content-Type') || ''))
  ) {
    throw new Error(`EduCore safe PWA resource could not be verified: ${relativePath}`);
  }
  if (expectedContent && !(await response.clone().text()).includes(expectedContent)) {
    throw new Error(`EduCore safe PWA resource could not be verified: ${relativePath}`);
  }
  await cache.put(url, response);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cachePublicShell(
      cache,
      OFFLINE_FILE,
      /^text\/html(?:\s*;|$)/i,
      '<meta name="educore-offline-shell" content="safe">',
    );
    await Promise.all(SAFE_ICON_FILES.map((file) =>
      cachePublicShell(cache, file, /^(?:image\/svg\+xml|image\/png)(?:\s*;|$)/i),
    ));
    // Keep only safe resources under the app's own base path.
    await trimStaticCache(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== STATIC_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !isScopedSameOrigin(url)) return;
  if (isDevPath(url.pathname)) return;

  // Navigations are always live; only show a generic cached page on a network error.
  if (request.mode === 'navigate') {
    // Do not let the browser's HTTP cache return a stale SPA document whose
    // uncached scripts cannot load. Only a live document or the safe shell
    // should be shown when navigating.
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(async () => {
      const cache = await caches.open(STATIC_CACHE);
      return (await cache.match(scopedUrl(OFFLINE_FILE))) ||
        new Response('EduCore is unavailable offline. Reconnect and try again.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
    }));
    return;
  }

  if (isSensitivePath(url.pathname)) return;
  const basePath = new URL(self.registration.scope).pathname;
  if (!isVersionedAsset(url.pathname, basePath)) return;

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    return cacheCheckedAsset(request, cache, basePath);
  })());
});

// Do not persist payloads or accept payload-supplied navigation URLs.
self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('Yemait EduCore', {
    body: 'You have a new notification. Open EduCore for details.',
    icon: scopedUrl('icons/educore-192.png'),
    tag: 'educore-notification',
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL('inbox', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => client.url.startsWith(self.registration.scope));
    if (existing) { await existing.navigate(target); return existing.focus(); }
    return self.clients.openWindow(target);
  }));
});