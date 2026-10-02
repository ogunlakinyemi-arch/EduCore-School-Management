import { describe, expect, it } from 'vitest';
import { categoryLabel, channelTruth, validPickupWindow } from './comm-contract';

describe('parent comm contract', () => {
  it('labels', () => { expect(categoryLabel('SECURITY')).toBe('Arrival and exit'); expect(categoryLabel('PARTNER')).toBe('PARTNER'); });
  it('channels are truthful', () => {
    expect(channelTruth({ channel: 'SMS', available: false, status: 'CONFIGURATION_REQUIRED' })).toMatch(/not set up/i);
    expect(channelTruth({ channel: 'IN_APP', available: true, status: 'AVAILABLE' })).toBe('Available');
  });
  it('validates windows', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    expect(validPickupWindow('', '', now)).toBeTruthy();
    expect(validPickupWindow('2025-01-02T10:00', '2025-01-02T09:00', now)).toBeTruthy();
    expect(validPickupWindow('2025-01-02T09:00', '2025-01-02T10:00', now)).toBeNull();
  });
});
