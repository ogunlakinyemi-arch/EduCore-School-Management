import { createHash } from "node:crypto";
import { AuthError } from "../middlewares/auth";

/** Canonicalize only client inputs. Server-generated dates must not change a retry's identity. */
export function partnerPayoutRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError(400, "A payout request is required");
  }
  const body = value as Record<string, unknown>;
  const fields = ["idempotencyKey", "partnerId", "amount", "currency", "periodStart", "periodEnd", "method", "notes"];
  if (Object.keys(body).some((key) => !fields.includes(key))) {
    throw new AuthError(400, "Unknown payout request field");
  }
  if (typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(body.idempotencyKey)) {
    throw new AuthError(400, "A client idempotencyKey of 8–100 letters, digits, underscores or hyphens is required");
  }
  const partnerId = typeof body.partnerId === "number" ? body.partnerId : NaN;
  if (!Number.isSafeInteger(partnerId) || partnerId < 1) throw new AuthError(400, "A valid Partner ID is required");
  const decimal = typeof body.amount === "number" && Number.isFinite(body.amount)
    ? String(body.amount) : typeof body.amount === "string" ? body.amount.trim() : "";
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(decimal);
  const amount = match ? BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0") : 0n;
  if (amount <= 0n || amount > 999999999999n) {
    throw new AuthError(400, "A positive amount within the two-decimal payout monetary range is required");
  }
  const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "NGN";
  if (!/^[A-Z]{3}$/.test(currency)) throw new AuthError(400, "A valid three-letter currency is required");
  const date = (key: string) => {
    if (body[key] === undefined || body[key] === null) return null;
    const value = body[key];
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new AuthError(400, `${key} must be a valid YYYY-MM-DD date`);
    }
    return value;
  };
  const optionalText = (key: string, max: number) => {
    if (body[key] === undefined || body[key] === null) return null;
    if (typeof body[key] !== "string" || body[key].length > max ||
        /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(body[key])) {
      throw new AuthError(400, `${key} is invalid`);
    }
    return body[key] as string;
  };
  const payload = {
    partnerId,
    amount: `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`,
    currency,
    periodStart: date("periodStart"),
    periodEnd: date("periodEnd"),
    method: optionalText("method", 100),
    notes: optionalText("notes", 2000),
  };
  if (payload.periodStart && payload.periodEnd && payload.periodStart > payload.periodEnd) {
    throw new AuthError(400, "periodStart must not be after periodEnd");
  }
  return {
    key: body.idempotencyKey,
    amount,
    payload,
    hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
}
