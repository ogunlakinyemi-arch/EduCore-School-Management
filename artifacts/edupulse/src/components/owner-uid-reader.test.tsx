// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnerUidReaderSection, readerConnection, type UidInventory } from './owner-uid-reader';

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
  it('shows unknown raw UIDs and duplicates independently of attendance or inventory assignment', () => {
    const reader = { ...data.readers[0], lastSeenAt: new Date().toISOString(),
      lastReport: { uid: 'AABBCCDD', scanStatus: 'UNKNOWN_UNASSIGNED' },
      lastScan: { uid: 'AABBCCDD', rawUid: 'aabbccdd', scanStatus: 'UNKNOWN_UNASSIGNED', duplicateUid: true } };
    const html = render({ data: { ...data, readers: [reader] } });
    expect(html).toContain('Unknown / unassigned card — UID captured');
    expect(html).toContain('aabbccdd');
    expect(html).toContain('Copy UID');
    expect(html).toContain('Duplicate UID');
    expect(html).toContain('Authenticated reader connected');
  });
  it.each(['UNSUPPORTED_CARD', 'MALFORMED_SCAN', 'READER_ERROR', 'TRANSPORT_ERROR'])('keeps the last raw result visible after %s', scanStatus => {
    const html = render({ data: { ...data, readers: [{ ...data.readers[0],
      lastReport: { uid: null, scanStatus }, lastScan: { uid: 'AABBCCDD', scanStatus: 'UNKNOWN_UNASSIGNED' },
    }] } });
    expect(html).toContain('Latest captured UID');
    expect(html).toContain('AABBCCDD');
    expect(html).toContain({
      UNSUPPORTED_CARD: 'Unsupported card', MALFORMED_SCAN: 'Malformed scan',
      READER_ERROR: 'Reader error', TRANSPORT_ERROR: 'Reader transport error',
    }[scanStatus]);
  });
  it('does not confuse an offline reader with missing assignment or a dashboard transport failure', () => {
    expect(readerConnection(data.readers[0], Date.now())).toBe('Waiting for authenticated reader');
    expect(readerConnection({ ...data.readers[0], lastSeenAt: new Date(Date.now() - 91_000).toISOString() })).toContain('offline');
    const html = render({ data, isError: true });
    expect(html).toContain('Dashboard transport error');
    expect(html).toContain('AABBCCDD');
    expect(html).toContain('Retry');
  });
  it('copies a displayed UID and reports clipboard errors without clearing the UID', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => { root.render(<OwnerUidReaderSection inventory={{ data, refetch: vi.fn() } as any} />); });
      const copy = [...container.querySelectorAll('button')].find(b => b.textContent === 'Copy UID')!;
      await act(async () => { copy.click(); });
      expect(writeText).toHaveBeenCalledWith('AABBCCDD');
      expect(container.textContent).toContain('UID copied');
      writeText.mockRejectedValueOnce(new Error('Permission denied'));
      await act(async () => { copy.click(); });
      expect(container.textContent).toContain('Copy failed');
      expect(container.textContent).toContain('AABBCCDD');
    } finally { await act(async () => root.unmount()); }
  });
});
