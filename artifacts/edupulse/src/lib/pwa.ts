export const PWA_METADATA = {
  name: 'Yemait EduCore',
  shortName: 'EduCore',
  description: 'Secure school operations, academics, payments, attendance, and family engagement from Yemait Technologies Limited.',
  themeColor: '#FF3C00',
  backgroundColor: '#FF3C00',
  display: 'standalone',
  orientation: 'any',
} as const;

export type PwaInstallEligibility = {
  hasInstallPrompt: boolean;
  isInstalled: boolean;
};

export function normalizePwaBasePath(basePath: string): string {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === '/') return '/';
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return path.endsWith('/') ? path : `${path}/`;
}

export function getPwaMetadata(basePath = '/'): typeof PWA_METADATA & {
  manifestHref: string;
  iconHref: string;
} {
  const base = normalizePwaBasePath(basePath);
  return {
    ...PWA_METADATA,
    manifestHref: `${base}manifest.webmanifest`,
    iconHref: `${base}icons/educore-192.png`,
  };
}

export function getPwaServiceWorkerUrl(basePath = '/'): string {
  return `${normalizePwaBasePath(basePath)}service-worker.js`;
}

export function isNativePwaInstallEligible(state: PwaInstallEligibility): boolean {
  return state.hasInstallPrompt && !state.isInstalled;
}

const SENSITIVE_PATH_SEGMENTS = new Set([
  'api',
  'auth',
  'callback',
  'clerk',
  '__clerk',
  'auth-callback',
  'invitation',
  'invitations',
  'login',
  'logout',
  'oauth',
  'private-object',
  'private-objects',
  'privateobjects',
  'private_objects',
  'register',
  'reset-password',
  'session',
  'sessions',
  'sign_in',
  'sign-in',
  'signin',
  'sign_up',
  'sign-up',
  'signup',
  'sso-callback',
  'upload',
  'uploads',
]);

export function isSensitivePwaPath(pathname: string): boolean {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  return decodedPath
    .split('/')
    .some((segment) => SENSITIVE_PATH_SEGMENTS.has(segment.toLowerCase()));
}

type StaticResponsePolicy = {
  pathname: string;
  contentType: string;
  cacheControl: string;
  status?: number;
  responseType?: string;
  vary?: string;
};

const STATIC_CONTENT_TYPES: Record<string, RegExp> = {
  css: /^text\/css(?:\s*;|$)/i,
  js: /^(?:text|application)\/javascript(?:\s*;|$)/i,
  mjs: /^(?:text|application)\/javascript(?:\s*;|$)/i,
  otf: /^font\/otf(?:\s*;|$)/i,
  ttf: /^font\/ttf(?:\s*;|$)/i,
  woff: /^font\/woff(?:\s*;|$)/i,
  woff2: /^font\/woff2(?:\s*;|$)/i,
};

function hasUnsafeVary(vary: string): boolean {
  return vary.split(',').some((header) => {
    const normalized = header.trim().toLowerCase();
    // Same-origin public assets may vary their CORS header, never their user.
    return normalized !== '' && normalized !== 'accept-encoding' && normalized !== 'origin';
  });
}

export function isSafeStaticAssetResponse({
  pathname,
  contentType,
  cacheControl,
  status = 200,
  responseType = 'basic',
  vary = '',
}: StaticResponsePolicy): boolean {
  if (
    status !== 200 ||
    responseType !== 'basic' ||
    /\b(?:private|no-store)\b/i.test(cacheControl) ||
    hasUnsafeVary(vary)
  ) {
    return false;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (isSensitivePwaPath(decodedPath)) return false;

  const segments = decodedPath.split('/').filter(Boolean);
  if (segments.at(-2) !== 'assets') return false;
  const file = segments.at(-1) ?? '';
  const match = file.match(/-([a-f0-9]{8,})\.(css|js|mjs|otf|ttf|woff|woff2)$/i);
  if (!match) return false;
  return STATIC_CONTENT_TYPES[match[2].toLowerCase()]?.test(contentType.trim()) ?? false;
}

export async function registerPwaServiceWorker(basePath = '/'): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) {
    return null;
  }
  return navigator.serviceWorker.register(getPwaServiceWorkerUrl(basePath), {
    scope: normalizePwaBasePath(basePath),
  });
}