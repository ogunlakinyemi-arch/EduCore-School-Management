import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnerUidReaderSection, type UidInventory } from './owner-uid-reader';

const render = (state: Record<string, unknown>) =>
  renderToStaticMarkup(<OwnerUidReaderSection inventory={{ isLoading: false, isError: false, refetch: () => undefined, data: undefined, ...state } as any} />);

const data: UidInventory = {
  readers: [{ deviceId: 7, serialNumber: 'HW-7', name: 'Desk reader', ownerUserId: 1, lastReadAt: null }],
  inventory: [
    { uid: 'AABBCCDD', readerDeviceId: 7, capturedAt: '2025-01-01T10:00:00Z', assigned: false, schoolId: null, studentId: null, status: null },
    { uid: '11223344', readerDeviceId: 7, capturedAt: '2025-01-01T10:01:00Z', assigned: true, schoolId: 2, studentId: 5, status: 'ACTIVE' },
  ],
};

describe('OwnerUidReaderSection', () => {
  it('shows empty and unregistered state without claiming a connection', () => {
    const html = render({ data: { readers: [], inventory: [] } });
    expect(html).toContain('No Owner UID reader bound');
    expect(html).toContain('Waiting for authenticated reader');
    expect(html).toContain('/api/v1/owner-reader/uid-events');
  });
  it('shows an error with retry', () => {
    const html = render({ isError: true });
    expect(html).toContain('UID inventory could not be loaded');
    expect(html).toContain('Retry');
  });
  it('shows available and assigned UIDs and a waiting reader', () => {
    const html = render({ data });
    expect(html).toContain('AABBCCDD');
    expect(html).toContain('Available');
    expect(html).toContain('Assigned');
    expect(html).toContain('Waiting for authenticated reader');
  });
  it('has no manual scan or submit control', () => {
    const html = render({ data });
    expect(html).not.toContain('<input');
    expect(html).not.toMatch(/simulate|manual scan/i);
  });
});
