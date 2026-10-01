import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../middlewares/auth";
import {
  decryptPayrollBankValue,
  encryptPayrollBankValue,
  getActivePayrollEncryptionKey,
  normalizeResolvedAccountName,
  payrollIdempotencyDigest,
  PayrollEncryptionConfigurationError,
} from "./payroll-bank-encryption";

const KEY_A = Buffer.from("a".repeat(64), "hex").toString("base64");
const KEY_B = Buffer.from("b".repeat(64), "hex").toString("base64");

describe("payroll bank information encryption", () => {
  beforeEach(() => {
    vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY", KEY_A);
    vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY_VERSION", "key-a");
    vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEYS", "");
    vi.stubEnv("PAYROLL_BANK_ENCRYPTION_ACTIVE_VERSION", "");
    vi.stubEnv("SESSION_SECRET", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("encrypts account numbers with a versioned randomized authenticated ciphertext", () => {
    const first = encryptPayrollBankValue("1234567890", "school:7:employee:22");
    const second = encryptPayrollBankValue("1234567890", "school:7:employee:22");

    expect(first.keyVersion).toBe("key-a");
    expect(first.ciphertext).toMatch(/^v1\./);
    expect(first.ciphertext).not.toContain("1234567890");
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(decryptPayrollBankValue(first.ciphertext, first.keyVersion, "school:7:employee:22"))
      .toBe("1234567890");
  });

  it("fails closed when its encryption key is unavailable, malformed, or the context is changed", () => {
    vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY", "");
    expect(() => getActivePayrollEncryptionKey()).toThrow(PayrollEncryptionConfigurationError);

    vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY", "not-a-key");
    expect(() => getActivePayrollEncryptionKey()).toThrow(/exactly 32 base64 bytes/);

    vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY", KEY_A);
    const encrypted = encryptPayrollBankValue("1234567890", "school:7");
    expect(() =>
      decryptPayrollBankValue(encrypted.ciphertext, encrypted.keyVersion, "school:8"),
    ).toThrow();
  });

  it("resolves configured keyring versions while keeping the active version explicit", () => {
    vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY", "");
    vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEYS", JSON.stringify({ "key-a": KEY_A, "key-b": KEY_B }));
    vi.stubEnv("PAYROLL_BANK_ENCRYPTION_ACTIVE_VERSION", "key-b");

    expect(getActivePayrollEncryptionKey()).toMatchObject({ version: "key-b" });
    vi.stubEnv("PAYROLL_BANK_ENCRYPTION_ACTIVE_VERSION", "missing");
    expect(() => getActivePayrollEncryptionKey()).toThrow(/unavailable or invalid/);
  });

  it("rejects empty data before it can create a bank-information row", () => {
    expect(() => encryptPayrollBankValue("  ", "company:employee:2"))
      .toThrow(AuthError);
  });

  it("derives independent deterministic digests instead of storing client idempotency keys", () => {
    expect(payrollIdempotencyDigest("header-secret")).toMatch(/^[0-9a-f]{64}$/);
    expect(payrollIdempotencyDigest("header-secret")).toBe(payrollIdempotencyDigest("header-secret"));
    expect(payrollIdempotencyDigest("header-secret")).not.toBe(payrollIdempotencyDigest("other-header"));
    expect(payrollIdempotencyDigest("header-secret")).not.toContain("header-secret");
  });

  it("compares verified account names without leaking or preserving formatting differences", () => {
    expect(normalizeResolvedAccountName(" Chioma O'Neil ")).toBe(normalizeResolvedAccountName("CHIOMA ONEIL"));
    expect(normalizeResolvedAccountName("Jane Doe")).not.toBe(normalizeResolvedAccountName("Jane Smith"));
  });
});