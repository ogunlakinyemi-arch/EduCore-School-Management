/** Reserved subscription category; NFC replacement and device fees are distinct. */
export const NFC_CATEGORY_PATTERN = "(nfc.*subscription|subscription.*nfc)";
export const isSystemNfcCategory = (name: string) => /nfc.*subscription|subscription.*nfc/i.test(name);
