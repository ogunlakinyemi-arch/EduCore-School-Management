import { createECDH } from "node:crypto";

/** Local validation only: never contacts a provider or exposes key material. */
export function vapidConfigurationProblem(config: { publicKey?: string; privateKey?: string; subject?: string }): string | null {
  let problem = "Push configuration validation failed.";
  try {
    const decode = (value: string | undefined, length: number, name: string) => {
      problem = `${name} is missing or is not a canonical base64url ${length}-byte key.`;
      if (!value || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error("Invalid key");
      const bytes = Buffer.from(value, "base64url");
      if (bytes.length !== length || bytes.toString("base64url") !== value.replace(/=+$/, ""))
        throw new Error("Invalid key");
      return bytes;
    };
    const publicKey = decode(config.publicKey, 65, "VAPID_PUBLIC_KEY");
    const privateKey = decode(config.privateKey, 32, "VAPID_PRIVATE_KEY");
    if (publicKey[0] !== 4) return "VAPID_PUBLIC_KEY must be an uncompressed P-256 public key.";
    if (!config.subject) return "VAPID_SUBJECT is missing.";
    if (/[\s\r\n]/.test(config.subject)) return "VAPID_SUBJECT must not contain whitespace.";
    problem = "VAPID_SUBJECT must be a valid mailto contact or HTTPS URL.";
    const subject = new URL(config.subject);
    if (subject.protocol === "mailto:") {
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(subject.pathname) || subject.search || subject.hash) return problem;
    } else if (subject.protocol !== "https:" || !subject.hostname || subject.username || subject.password || subject.hash) {
      return problem;
    }
    const curve = createECDH("prime256v1");
    problem = "VAPID_PRIVATE_KEY is not a valid P-256 private key.";
    curve.setPrivateKey(privateKey);
    return curve.getPublicKey(undefined, "uncompressed").equals(publicKey)
      ? null : "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY do not form a matching key pair.";
  } catch {
    return problem;
  }
}

export function validVapidConfiguration(config: { publicKey?: string; privateKey?: string; subject?: string }): boolean {
  return vapidConfigurationProblem(config) === null;
}

export function vapidConfiguration(env: NodeJS.ProcessEnv = process.env) {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}
