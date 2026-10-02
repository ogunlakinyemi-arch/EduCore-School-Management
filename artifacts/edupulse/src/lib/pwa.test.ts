import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getPwaMetadata,
  getPwaServiceWorkerUrl,
  isNativePwaInstallEligible,
  isSafeStaticAssetResponse,
  isSensitivePwaPath,
  normalizePwaBasePath,
} from './pwa';

const workerSource = readFileSync(new URL('../../public/service-worker.js', import.meta.url), 'utf8');

describe('EduCore PWA metadata and install eligibility', () => {
  it('keeps manifest, icon, and service-worker URLs inside the configured app base path', () => {
    expect(normalizePwaBasePath('/school/app')).toBe('/school/app/');
    expect(getPwaMetadata('/school/app')).toMatchObject({
      name: 'Yemait EduCore',
      shortName: 'EduCore',
      manifestHref: '/school/app/manifest.webmanifest',
      iconHref: '/school/app/icons/educore-192.png',
      display: 'standalone',
      orientation: 'any',
    });
    expect(getPwaServiceWorkerUrl('/school/app/')).toBe('/school/app/service-worker.js');
  });

  it('offers an install button only when the browser supplied its real install prompt', () => {
    expect(isNativePwaInstallEligible({ hasInstallPrompt: false, isInstalled: false })).toBe(false);
    expect(isNativePwaInstallEligible({ hasInstallPrompt: true, isInstalled: true })).toBe(false);
    expect(isNativePwaInstallEligible({ hasInstallPrompt: true, isInstalled: false })).toBe(true);
  });
});

describe('EduCore safe static cache policy', () => {
  it('allows only successful same-origin-style versioned asset responses with public resource types', () => {
    expect(isSafeStaticAssetResponse({
      pathname: '/assets/app-a1b2c3d4.js',
      contentType: 'text/javascript; charset=utf-8',
      cacheControl: 'public, max-age=31536000, immutable',
    })).toBe(true);
    expect(isSafeStaticAssetResponse({
      pathname: '/base/assets/font-0123456789abcdef.woff2',
      contentType: 'font/woff2',
      cacheControl: 'public',
    })).toBe(true);
  });

  it('rejects dynamic, sensitive, unversioned, private, and invalid responses', () => {
    const policy = {
      contentType: 'text/javascript',
      cacheControl: 'public, max-age=31536000',
    };
    expect(isSafeStaticAssetResponse({ ...policy, pathname: '/api/assets/bundle-a1b2c3d4.js' })).toBe(false);
    expect(isSafeStaticAssetResponse({ ...policy, pathname: '/assets/bundle.js' })).toBe(false);
    expect(isSafeStaticAssetResponse({ ...policy, pathname: '/assets/bundle-a1b2c3d4.js', cacheControl: 'private' })).toBe(false);
    expect(isSafeStaticAssetResponse({ ...policy, pathname: '/assets/bundle-a1b2c3d4.js', cacheControl: 'no-store' })).toBe(false);
    expect(isSafeStaticAssetResponse({ ...policy, pathname: '/assets/bundle-a1b2c3d4.js', status: 302 })).toBe(false);
    expect(isSafeStaticAssetResponse({ ...policy, pathname: '/assets/bundle-a1b2c3d4.js', responseType: 'opaque' })).toBe(false);
    expect(isSafeStaticAssetResponse({ ...policy, pathname: '/assets/bundle-a1b2c3d4.js', vary: '*' })).toBe(false);
    expect(isSafeStaticAssetResponse({ ...policy, pathname: '/assets/bundle-a1b2c3d4.js', vary: 'Cookie' })).toBe(false);
  });

  it('recognizes auth, tenant API, uploads, invitations, and private object paths as non-cacheable', () => {
    for (const path of [
      '/api/students',
      '/sign-in',
      '/sign_in',
      '/sign-up',
      '/clerk/session',
      '/invitations/accept',
      '/uploads/report.csv',
      '/private-objects/medical-record',
      '/privateobjects/student-record',
    ]) {
      expect(isSensitivePwaPath(path), path).toBe(true);
    }
    expect(isSensitivePwaPath('/assets/app-a1b2c3d4.js')).toBe(false);
    expect(isSensitivePwaPath('/%E0%A4%A')).toBe(true);
  });
});

describe('service-worker security invariants', () => {
  it('allows same-origin public CORS variation without allowing credential-dependent caching', () => {
    const asset = {
      pathname: '/assets/app-a1b2c3d4.js',
      contentType: 'application/javascript',
      cacheControl: 'public, max-age=31536000',
    };
    expect(isSafeStaticAssetResponse({ ...asset, vary: 'Origin, Accept-Encoding' })).toBe(true);
    for (const vary of ['Cookie', 'Authorization', '*', 'Origin, Cookie']) {
      expect(isSafeStaticAssetResponse({ ...asset, vary }), vary).toBe(false);
    }
    expect(isSafeStaticAssetResponse({ ...asset, vary: 'Origin', cacheControl: 'private, no-store' })).toBe(false);
  });

  it('keeps navigations network-only and shows only the generic offline shell on failure', () => {
    expect(workerSource).toContain("if (request.mode === 'navigate')");
    expect(workerSource).toContain("fetch(request, { cache: 'no-store' }).catch(async () =>");
    expect(workerSource).toContain("cache.match(scopedUrl(OFFLINE_FILE))");
    expect(workerSource).toContain("'<meta name=\"educore-offline-shell\" content=\"safe\">'");
    expect(workerSource).not.toMatch(/cache\.put\(request,\s*response\.clone\(\)\)[\s\S]{0,100}request\.mode\s*===\s*['"]navigate/);
  });

  it('bypasses dev server modules, non-GET, cross-origin, sensitive paths, and unversioned resources', () => {
    expect(workerSource).toContain('/(?:src|@fs|@vite)');
    expect(workerSource).toContain("if (request.method !== 'GET') return;");
    expect(workerSource).toContain('url.origin !== self.location.origin');
    expect(workerSource).toContain('if (isSensitivePath(url.pathname)) return;');
    expect(workerSource).toContain('if (!isVersionedAsset(url.pathname, basePath)) return;');
    expect(workerSource).toContain('MAX_STATIC_ENTRIES = 80');
    expect(workerSource).toContain('name.startsWith(CACHE_PREFIX) && name !== STATIC_CACHE');
  });

  it('keeps the manifest installable and points at real Zap brand icons', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8'));
    expect(manifest).toMatchObject({
      name: 'Yemait EduCore',
      short_name: 'EduCore',
      start_url: './',
      scope: './',
      display: 'standalone',
      theme_color: '#FF3C00',
    });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: 'icons/educore-192.png', sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ src: 'icons/educore-512.png', sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ src: 'icons/educore-maskable-512.png', sizes: '512x512', purpose: 'maskable' }),
    ]));
    expect(readFileSync(new URL('../../public/icons/educore-icon.svg', import.meta.url), 'utf8')).toContain('M104 19');
    for (const [file, size] of [
      ['educore-192.png', 192],
      ['educore-512.png', 512],
      ['educore-maskable-512.png', 512],
    ]) {
      const icon = readFileSync(new URL(`../../public/icons/${file}`, import.meta.url));
      expect(icon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(icon.readUInt32BE(16)).toBe(size);
      expect(icon.readUInt32BE(20)).toBe(size);
    }
  });

  it('marks only the generic offline-unavailable page as a cacheable shell', () => {
    const offline = readFileSync(new URL('../../public/offline.html', import.meta.url), 'utf8');
    expect(offline).toContain('<meta name="educore-offline-shell" content="safe">');
    expect(offline).toContain('EduCore isn’t available offline');
    expect(offline).toContain('School records and account information are not stored for offline use.');
  });
});