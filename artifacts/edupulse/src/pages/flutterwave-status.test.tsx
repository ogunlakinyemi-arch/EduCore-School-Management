import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderBanner } from './payroll-common';
import type { SettlementProviderCapability } from '@workspace/api-client-react';

const capability: SettlementProviderCapability = {
  provider: 'FLUTTERWAVE', mode: 'NOT_CONFIGURED', credentialsConfigured: false,
  transferCapability: 'NOT_CONFIGURED', bankSubaccountsSupported: false, liveSettlementVerified: false,
  collection: {
    mode: 'TEST', credentialState: 'CONFIGURED', credentialsConfigured: true,
    webhookConfigured: true, checkoutConfigured: true, assistedCheckoutConfigured: true,
    checkoutVerified: false, automaticSplitSettlementEnabled: false,
    automaticSplitSettlementVerified: false, subaccountIntegration: 'NOT_IMPLEMENTED',
    bankAccountVerificationConfigured: true,
  },
};
describe('truthful Flutterwave settlement status', () => {
  it('reports TEST collections independently of unavailable payouts', () => {
    const html = renderToStaticMarkup(<ProviderBanner capability={capability} />);
    expect(html).toContain('payment mode TEST');
    expect(html).toContain('Payout transfer mode: NOT CONFIGURED');
    expect(html).toContain('configured on server');
    expect(html).not.toContain('unsupported by provider API');
  });
  it('never equates configuration, internal allocations or bank verification with payment or settlement proof', () => {
    const html = renderToStaticMarkup(<ProviderBanner capability={capability} />);
    expect(html).toContain('Genuine checkout/payment acceptance: not verified');
    expect(html).toContain('Automatic school/partner split settlement: not implemented or verified');
    expect(html).toContain('dashboard delivery not verified');
    expect(html).toContain('Live settlement verified: no');
  });
  it('keeps missing webhook authentication distinct from hosted checkout configuration', () => {
    const html = renderToStaticMarkup(<ProviderBanner capability={{ ...capability,
      collection: { ...capability.collection!, webhookConfigured: false, assistedCheckoutConfigured: false },
    }} />);
    expect(html).toContain('not configured; incoming events fail closed');
    expect(html).toContain('Assisted public checkout: not ready');
    expect(html).toContain('ready for TEST initialization');
  });
});
