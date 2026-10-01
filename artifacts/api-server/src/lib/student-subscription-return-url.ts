import { PUBLIC_PRODUCTION_ORIGIN } from "../routes/invitation-redirect";

type StudentSubscriptionReturnUrlConfig = {
  environment?: string;
  publicAppUrl?: string;
  developmentDomain?: string;
  developmentBasePath?: string;
};

const DEVELOPMENT_DOMAIN_PATTERN =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+replit\.dev$/i;

function validBasePath(pathname: string): string | null {
  if (!pathname || pathname === "/") return "";
  const segments = pathname.split("/").filter(Boolean);
  if (pathname.includes("//") || segments.some((segment) =>
    segment === "." || segment === ".." || !/^[A-Za-z0-9._~-]+$/.test(segment))) {
    return null;
  }
  return `/${segments.join("/")}`;
}

function safePublicBase(value: string): string | null {
  const originalPath = /^https:\/\/[^/?#]*(\/[^?#]*)?/i.exec(value)?.[1] ?? "/";
  let hasUnsafePath = false;
  for (const segment of originalPath.split("/")) {
    try {
      const decoded = decodeURIComponent(segment);
      if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")
          || /[\u0000-\u001f\u007f]/.test(decoded)) hasUnsafePath = true;
    } catch {
      hasUnsafePath = true;
    }
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const basePath = validBasePath(url.pathname);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash
      || basePath === null || hasUnsafePath
      || hostname === "replit.dev" || hostname.endsWith(".replit.dev")
      || hostname === "replit.com" || hostname.endsWith(".replit.com")
      || hostname === "localhost" || hostname.endsWith(".localhost")
      || hostname.endsWith(".local") || !hostname.includes(".")
      || /^[\d.]+$/.test(hostname) || hostname.includes(":")) {
    return null;
  }
  return `${url.origin}${basePath}`;
}

/**
 * A separate, server-owned callback for the student-subscription checkout.
 * It intentionally does not read FEE_PAYMENT_RETURN_URL or request headers,
 * so the existing invoice callback contract stays unchanged.
 */
export function configuredStudentSubscriptionCheckoutBaseUrl(
  config: StudentSubscriptionReturnUrlConfig = {},
): string | null {
  const environment = config.environment ?? process.env.NODE_ENV;
  if (environment === "development") {
    const domain = (config.developmentDomain ?? process.env.REPLIT_DEV_DOMAIN)?.trim();
    if (!domain || !DEVELOPMENT_DOMAIN_PATTERN.test(domain)) return null;
    const basePath = validBasePath(config.developmentBasePath ?? process.env.STUDENT_SUBSCRIPTION_APP_BASE_PATH ?? "/");
    if (basePath === null) return null;
    return `https://${domain.toLowerCase()}${basePath}`;
  }
  const configured = config.publicAppUrl ?? process.env.PUBLIC_APP_URL;
  return safePublicBase(configured ?? PUBLIC_PRODUCTION_ORIGIN);
}

export function studentSubscriptionCheckoutReturnUrl(
  subscriptionId: number,
  paymentId: number,
  reference: string,
  config: StudentSubscriptionReturnUrlConfig = {},
): string | null {
  if (!Number.isSafeInteger(subscriptionId) || subscriptionId < 1
      || !Number.isSafeInteger(paymentId) || paymentId < 1
      || !/^[A-Za-z0-9_-]{8,100}$/.test(reference)) {
    throw new TypeError("A persisted student subscription payment is required for its callback URL");
  }
  const baseUrl = configuredStudentSubscriptionCheckoutBaseUrl(config);
  if (!baseUrl) return null;
  const target = new URL(baseUrl);
  target.pathname = `${target.pathname.replace(/\/+$/, "")}/subscriptions`;
  target.searchParams.set("subscriptionId", String(subscriptionId));
  target.searchParams.set("paymentId", String(paymentId));
  target.searchParams.set("paymentReference", reference);
  return target.toString();
}