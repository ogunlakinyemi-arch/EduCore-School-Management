/** Reserved subscription category; NFC replacement and device fees are distinct. */
export const NFC_CATEGORY_PATTERN = "(nfc.*subscription|subscription.*nfc)";
export const isSystemNfcCategory = (name: string) => /nfc.*subscription|subscription.*nfc/i.test(name);
/** Explicitly school-owned charge; never platform entitlement or a split. The
 * historical detector above remains unchanged for reconciliation. */
export const isReservedPlatformNfcCategory=(name:string)=>isSystemNfcCategory(name)&&!/^school\s+nfc\b/i.test(name.trim());
