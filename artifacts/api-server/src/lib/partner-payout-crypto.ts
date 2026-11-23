import {createDecipheriv,hkdfSync} from "node:crypto";
/** Existing Partner cipher (not payroll AAD). Kept identical for retained ciphertext. */
export function decryptPartnerPayoutValue(value:string,version:string,env:NodeJS.ProcessEnv=process.env){
  let ring:Record<string,string>={};
  if(env.PAYOUT_ENCRYPTION_KEYS)ring=JSON.parse(env.PAYOUT_ENCRYPTION_KEYS);
  const secret=ring[version]??(version===(env.PAYOUT_ENCRYPTION_KEY_VERSION||"payout-v1")?env.PAYOUT_ENCRYPTION_KEY:undefined)
    ??(["v1","session-hkdf-v1"].includes(version)?env.SESSION_SECRET:undefined);
  if(!secret)throw new Error("PARTNER_BANK_DECRYPTION_UNAVAILABLE");
  const key=Buffer.from(hkdfSync("sha256",secret,Buffer.alloc(0),
    `edupulse-partner-payout-encryption-${version==="session-hkdf-v1"?"v1":version}`,32));
  const parts=value.split(".");if(parts.length!==3)throw new Error("PARTNER_BANK_CIPHERTEXT_INVALID");
  const [iv,body,tag]=parts.map(v=>Buffer.from(v,"base64"));
  const cipher=createDecipheriv("aes-256-gcm",key,iv!);cipher.setAuthTag(tag!);
  return Buffer.concat([cipher.update(body!),cipher.final()]).toString("utf8");
}
