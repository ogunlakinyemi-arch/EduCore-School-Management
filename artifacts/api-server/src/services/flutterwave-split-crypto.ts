import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { AuthError } from "../middlewares/auth";
import type { BankDetails } from "./flutterwave-split-provider";

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new AuthError(503, "Settlement-detail encryption is unavailable");
  return Buffer.from(hkdfSync("sha256", secret, "educore-flutterwave-splits", "bank-details-v1", 32));
}
export function encryptSplitBank(bank: BankDetails) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(bank), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64")).join(".");
}
export function decryptSplitBank(value: string): BankDetails {
  try {
    const [iv, tag, data] = value.split(".").map(v => Buffer.from(v, "base64"));
    const cipher = createDecipheriv("aes-256-gcm", key(), iv);
    cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8"));
  } catch { throw new AuthError(503, "Stored settlement details cannot be decrypted; review encryption-key retention"); }
}
export function splitBankFingerprint(bankCode: string, accountNumber: string) {
  return createHmac("sha256", key()).update(`${bankCode}:${accountNumber}`).digest("hex");
}
