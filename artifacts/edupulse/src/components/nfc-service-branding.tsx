/** Display copy only; deliberately independent of payment state and provider configuration. */
export function NfcServiceBranding() {
  return <section className="my-4 space-y-2 text-sm" aria-label="NFC service provider" data-testid="nfc-service-branding">
    <dl className="space-y-1">
      <div>Platform: <strong>Yetenia EduCore</strong></div>
      <div>Company: <strong>YETENIA TECHNOLOGIES LIMITED</strong></div>
      <div>Service: <strong>NFC Student Attendance and School Entry Notifications</strong></div>
    </dl>
    <a className="text-xs underline" href="https://yetenia.com" target="_blank" rel="noreferrer noopener">yetenia.com</a>
    <p className="text-xs leading-5">
      Yetenia EduCore is operated by YETENIA TECHNOLOGIES LIMITED. Platform subscriptions are separate from school-issued NFC/card fees and ordinary school fees. Schools control only their own parent-facing fees, not the platform price. Historical amounts remain unchanged; a submitted payment or receipt is not independently verified payment.
    </p>
  </section>;
}
