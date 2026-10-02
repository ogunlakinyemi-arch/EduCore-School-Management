import { describe, expect, it } from 'vitest';
import { canArchiveNotification, inboxArchiveView } from './communication-contract';

describe('inbox archive controls', () => {
  const rows = [
    { id: 1, isArchived: false },
    { id: 2, isArchived: true },
    { id: 3, isArchived: false },
  ];
  it('keeps archived rows out of the active inbox', () => {
    expect(inboxArchiveView(rows, false).map(row => row.id)).toEqual([1, 3]);
  });
  it('shows only archived rows in the archive view', () => {
    expect(inboxArchiveView(rows, true).map(row => row.id)).toEqual([2]);
  });
  it('does not offer archiving for required account or security notices', () => {
    expect(canArchiveNotification('ACCOUNT')).toBe(false);
    expect(canArchiveNotification('SECURITY')).toBe(false);
  });
  it('offers archiving for ordinary school announcements and academic updates', () => {
    expect(canArchiveNotification('ANNOUNCEMENT')).toBe(true);
    expect(canArchiveNotification('ACADEMIC')).toBe(true);
  });
});