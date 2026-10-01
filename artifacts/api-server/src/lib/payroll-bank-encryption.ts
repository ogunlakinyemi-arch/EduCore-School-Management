import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { AuthError } from "../middlewares/auth";

const KEY_BYTES = 32;
const ENCRYPTION_DOMAIN = "yemait-educore/payroll-bank-information/aes-256-gcm";

export class PayrollEncryptionConfigurationError extends Error {
  constructor(message = "Secure payroll bank-information encryption is not configured") {
    super(message);
    this.name = "PayrollEncryptionConfigurationError";
  }
}

export interface ActivePayrollKey {
  key: Buffer;
  version: string;
}

function decodeKey(encoded: string | undefined): Buffer | null {
  if (!encoded) return null;
  const trimmed = encoded.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  try {
    const decoded = Buffer.from(trimmed, "base64");
    return decoded.length === KEY_BYTES ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Uses a payroll-only versioned keyring. The SESSION_SECRET option derives a
 * separate, purpose-bound key with HKDF; it can never reuse a partner-payout
 * key or another field's ciphertext as plaintext. No plaintext fallback exists.
 */
export function getActivePayrollEncryptionKey(
  env: NodeJS.ProcessEnv = process.env,
): ActivePayrollKey {
  const configuredVersion = env.PAYROLL_BANK_ENCRYPTION_ACTIVE_VERSION?.trim();
  if (configuredVersion) {
    const encodedKey = env.PAYROLL_BANK_ENCRYPTION_KEYS
      ? (() => {
          try {
            const ring: unknown = JSON.parse(env.PAYROLL_BANK_ENCRYPTION_KEYS);
            if (!ring || typeof ring !== "object" || Array.isArray(ring)) {
              throw new Error();
            }
            const selected = (ring as Record<string, unknown>)[configuredVersion];
            return typeof selected === "string" ? selected : undefined;
          } catch {
            throw new PayrollEncryptionConfigurationError(
              "Payroll bank-encryption keyring configuration is invalid",
            );
          }
        })()
      : configuredVersion === (env.PAYROLL_BANK_ENCRYPTION_KEY_VERSION ?? "v1")
        ? env.PAYROLL_BANK_ENCRYPTION_KEY
        : undefined;

    const key = decodeKey(encodedKey);
    if (!key) {
      throw new PayrollEncryptionConfigurationError(
        "The active payroll bank-encryption key version is unavailable or invalid",
      );
    }
    return { key, version: configuredVersion };
  }

  const rawKey = decodeKey(env.PAYROLL_BANK_ENCRYPTION_KEY);
  if (rawKey) {
    return {
      key: rawKey,
      version: env.PAYROLL_BANK_ENCRYPTION_KEY_VERSION?.trim() || "v1",
    };
  }
  if (env.PAYROLL_BANK_ENCRYPTION_KEY) {
    throw new PayrollEncryptionConfigurationError(
      "PAYROLL_BANK_ENCRYPTION_KEY must contain exactly 32 base64 bytes or 64 hexadecimal characters",
    );
  }

  const sessionSecret = env.SESSION_SECRET?.trim();
  if (sessionSecret && sessionSecret.length >= 32) {
    const key = hkdfSync(
      "sha256",
      Buffer.from(sessionSecret, "utf8"),
      Buffer.from("yemait-educore", "utf8"),
      Buffer.from(ENCRYPTION_DOMAIN, "utf8"),
      KEY_BYTES,
    );
    return { key: Buffer.from(key), version: "session-hkdf-v1" };
  }
  throw new PayrollEncryptionConfigurationError();
}

export function encryptPayrollBankValue(value: string, associatedData: string): {
  ciphertext: string;
  keyVersion: string;
} {
  const key = getActivePayrollEncryptionKey();
  const normalized = value.trim();
  if (!normalized) {
    throw new AuthError(400, "Bank-account information cannot be empty");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(Buffer.from(`${ENCRYPTION_DOMAIN}:${key.version}:${associatedData}`, "utf8"));
  const encrypted = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`,
    keyVersion: key.version,
  };
}

export function decryptPayrollBankValue(
  ciphertext: string,
  keyVersion: string,
  associatedData: string,
): string {
  if (!/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ciphertext)) {
    throw new PayrollEncryptionConfigurationError("Stored payroll bank information is invalid");
  }
  const key = getActivePayrollEncryptionKey();
  if (key.version !== keyVersion) {
    throw new PayrollEncryptionConfigurationError(
      `Payroll bank-encryption key version "${keyVersion}" must be configured for secure decryption`,
    );
  }
  const [, ivPart, ciphertextPart, tagPart] = ciphertext.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key.key,
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAAD(Buffer.from(`${ENCRYPTION_DOMAIN}:${key.version}:${associatedData}`, "utf8"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Hashes (never stores) caller idempotency tokens before they reach Postgres. */
export function payrollIdempotencyDigest(value: string): string {
  return createHmac("sha256", Buffer.from("payroll-idempotency-v1", "utf8"))
    .update(value, "utf8")
    .digest("hex");
}

export function normalizeResolvedAccountName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-NG")
    .replace(/[^\p{L}\p{N}]/gu, "");
}