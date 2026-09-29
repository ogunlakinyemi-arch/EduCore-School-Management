import { describe, expect, it } from 'vitest';
import { campaignStatusLabel, deliveryStatusLabel, inboxItems, isSimulatedDelivery, manualCategory, pushDevices, visibleCommunicationNotifications } from './communication-contract';
import type { CommunicationNotification } from '@workspace/api-client-react';

describe('communication contract', () => {
  it('restricts manual messaging to general notices, not lifecycle events', () => {
    expect(manualCategory('admin')).toBe('ANNOUNCEMENT');
    expect(manualCategory('teacher')).toBe('ANNOUNCEMENT');
    expect(manualCategory('accountant')).toBe('FINANCE');
  });
  it('never presents test-provider acceptance as real delivery', () => {
    for (const provider of ['development-sms', 'development-email', 'dev-test']) {
      expect(isSimulatedDelivery({ provider, errorCode: null })).toBe(true);
      expect(deliveryStatusLabel({ provider, errorCode: null, status: 'SENT' })).toBe('Simulated send');
    }
    expect(deliveryStatusLabel({ provider: null, errorCode: 'SIMULATED', status: 'DELIVERED' })).toBe('Simulated send');
    expect(deliveryStatusLabel({ provider: 'real-provider', errorCode: null, status: 'SENT' })).toBe('SENT');
    expect(campaignStatusLabel('SENT')).toBe('Processed');
  });
  it('respects paginated inbox and bare push-device array responses', () => {
    expect(inboxItems({ items: [], unreadCount: 0, hasMore: false, nextBeforeId: null })).toEqual([]);
    expect(pushDevices([])).toEqual([]);
  });
  it('keeps campaign finance notices but excludes only system finance and payment notices', () => {
    const items = [
      { id: 1, origin: 'SYSTEM', category: 'FINANCE' },
      { id: 2, origin: 'SYSTEM', category: 'PAYMENT' },
      { id: 3, origin: 'CAMPAIGN', category: 'FINANCE' },
      { id: 4, origin: 'SYSTEM', category: 'ANNOUNCEMENT' },
      { id: 5, origin: 'CAMPAIGN', category: 'PAYMENT' },
    ] as unknown as Array<CommunicationNotification & { origin: 'SYSTEM' | 'CAMPAIGN' }>;
    expect(visibleCommunicationNotifications(items).map(item => item.id)).toEqual([3, 4, 5]);
  });
});