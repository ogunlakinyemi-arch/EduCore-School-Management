import { createECDH } from "node:crypto";

/** Local validation only: never contacts a provider or exposes key material. */
export function validVapidConfiguration(config: { publicKey?: string; privateKey?: string; subject?: string }): boolean {
  try {
    const decode = (value: string | undefined, length: number) => {
      if (!value || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error("Invalid key");
      const bytes = Buffer.from(value, "base64url");
      if (bytes.length !== length || bytes.toString("base64url") !== value.replace(/=+$/, ""))
        throw new Error("Invalid key");
      return bytes;
    };
    const publicKey = decode(config.publicKey, 65);
    const privateKey = decode(config.privateKey, 32);
    if (publicKey[0] !== 4 || !config.subject || /[\s\r\n]/.test(config.subject)) return false;
    const subject = new URL(config.subject);
    if (subject.protocol === "mailto:") {
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(subject.pathname) || subject.search || subject.hash) return false;
    } else if (subject.protocol !== "https:" || !subject.hostname || subject.username || subject.password || subject.hash) {
      return false;
    }
    const curve = createECDH("prime256v1");
    curve.setPrivateKey(privateKey);
    return curve.getPublicKey(undefined, "uncompressed").equals(publicKey);
  } catch {
    return false;
  }
}

export function vapidConfiguration(env: NodeJS.ProcessEnv = process.env) {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}
