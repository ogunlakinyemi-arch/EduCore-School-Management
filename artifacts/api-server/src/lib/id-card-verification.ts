import { createCipheriv, createDecipheriv, createHmac, hkdfSync } from "node:crypto";

type CardIdentity = {cardId:number;schoolId:number;studentId:number|null;employeeId:number|null};
function keys() {
  const secret=process.env.SESSION_SECRET;
  if(!secret || secret.length<16) throw new Error("ID card verification signing configuration is unavailable");
  return {
    encryption:Buffer.from(hkdfSync("sha256",secret,"educore-id-card-v1","encryption",32)),
    nonce:Buffer.from(hkdfSync("sha256",secret,"educore-id-card-v1","nonce",32)),
  };
}
/** Stable opaque authenticated ciphertext. No UID, name, contact or photo in payload.
 * The keyed nonce is bound to the complete immutable plaintext; identical identity
 * reprints are identical and different identities have independent 96-bit nonces.
 * Rotating SESSION_SECRET invalidates older printed verification tokens. */
export function cardVerificationToken(identity:CardIdentity) {
  const k=keys(), plain=Buffer.from(JSON.stringify([identity.cardId,identity.schoolId,identity.studentId,identity.employeeId]));
  const iv=createHmac("sha256",k.nonce).update(plain).digest().subarray(0,12);
  const cipher=createCipheriv("aes-256-gcm",k.encryption,iv);
  const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
  return `EID1.${Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString("base64url")}`;
}
export function readCardVerificationToken(token:unknown):CardIdentity|null {
  if(typeof token!=="string" || !/^EID1\.[A-Za-z0-9_-]{40,250}$/.test(token)) return null;
  const k=keys();
  try {
    const bytes=Buffer.from(token.slice(5),"base64url");
    const decipher=createDecipheriv("aes-256-gcm",k.encryption,bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(12,28));
    const ids=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString("utf8"));
    if(!Array.isArray(ids)||ids.length!==4 || !ids.slice(0,2).every(x=>Number.isSafeInteger(x)&&x>0) ||
      !ids.slice(2).every(x=>x===null || Number.isSafeInteger(x)&&x>0) ||
      (ids[2]===null)===(ids[3]===null)) return null;
    return {cardId:ids[0],schoolId:ids[1],studentId:ids[2],employeeId:ids[3]};
  } catch {return null;}
}
