/** Display copy only; deliberately independent of payment state and provider configuration. */
export function NfcServiceBranding() {
  return <section className="my-4 space-y-2 text-sm" aria-label="NFC service provider" data-testid="nfc-service-branding">
    <dl className="space-y-1">
      <div>Platform: <strong>Yemait EduCore</strong></div>
      <div>Company: <strong>YETENIA TECHNOLOGIES LIMITED</strong></div>
      <div>Service: <strong>NFC Student Attendance and School Entry Notifications</strong></div>
    </dl>
    <a className="text-xs underline" href="https://yetenia.com" target="_blank" rel="noreferrer noopener">yetenia.com</a>
    <p className="text-xs leading-5">
      This NFC subscription is provided through Yemait EduCore, operated by YETENIA TECHNOLOGIES LIMITED. Your payment is processed according to the configured payment arrangements for your school and the platform.
    </p>
  </section>;
}
