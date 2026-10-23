import { describe, expect, it } from 'vitest';
import { channelSetupAvailable, channelTruth } from './comm-contract';

describe('notification setup is not delivery authorization', () => {
  it.each(['EMAIL', 'PUSH'] as const)('allows %s preference setup while delivery is held', channel => {
    const row = { channel, available: false, setupAvailable: true, status: 'CONFIGURATION_REQUIRED' as const };
    expect(channelSetupAvailable(row)).toBe(true);
    expect(channelTruth(row)).toBe('Setup enabled · sending held');
  });
  it('does not infer setup from an unconfigured channel or enable SMS/Telegram', () => {
    expect(channelSetupAvailable({ channel: 'EMAIL', available: false, setupAvailable: false })).toBe(false);
    expect(channelSetupAvailable({ channel: 'SMS', available: true, setupAvailable: true })).toBe(false);
    expect(channelSetupAvailable({ channel: 'TELEGRAM', available: false, setupAvailable: true })).toBe(false);
  });
  it('accepts older API responses without fabricating new availability', () => {
    expect(channelSetupAvailable({ channel: 'PUSH', available: true })).toBe(true);
    expect(channelSetupAvailable({ channel: 'PUSH', available: false })).toBe(false);
  });
});
