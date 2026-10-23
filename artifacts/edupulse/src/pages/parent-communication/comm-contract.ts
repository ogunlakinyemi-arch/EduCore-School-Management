import type { CommunicationCategory, CommunicationChannelAvailabilityChannelsItem } from '@workspace/api-client-react';

export const ACTIVITY_CATEGORIES: CommunicationCategory[] = ['SECURITY', 'ATTENDANCE', 'FINANCE', 'ACADEMIC', 'ASSIGNMENT'];
export const CATEGORY_LABEL: Partial<Record<CommunicationCategory, string>> = { SECURITY: 'Arrival and exit', ATTENDANCE: 'Attendance', FINANCE: 'Fees', PAYMENT: 'Payments', ACADEMIC: 'Results', ASSIGNMENT: 'Homework', ANNOUNCEMENT: 'Announcements', ACCOUNT: 'Account', SYSTEM: 'System' };

export function categoryLabel(c: CommunicationCategory): string { return CATEGORY_LABEL[c] ?? c.replaceAll('_', ' '); }

export function channelSetupAvailable(c: Pick<CommunicationChannelAvailabilityChannelsItem, 'available' | 'setupAvailable' | 'channel'>): boolean {
  if (c.channel === 'SMS') return false;
  return c.channel === 'EMAIL' || c.channel === 'PUSH' ? (c.setupAvailable ?? c.available) : c.available;
}

export function channelTruth(c: Pick<CommunicationChannelAvailabilityChannelsItem, 'available' | 'setupAvailable' | 'status' | 'channel'>): string {
  if (c.channel === 'IN_APP' && c.available) return 'Available';
  if (!c.available && channelSetupAvailable(c)) return 'Setup enabled · sending held';
  if (c.available) return 'Available';
  return c.status === 'CONFIGURATION_REQUIRED' ? 'Not set up by the school yet' : 'Unavailable';
}

export function toLocalIso(v: string): string | undefined { return v ? new Date(v).toISOString() : undefined; }
export function validPickupWindow(from: string, until: string, now = new Date()): string | null {
  if (!from || !until) return 'Choose when the person may collect.';
  const f = new Date(from).getTime(); const u = new Date(until).getTime();
  if (!(u > f)) return 'The end must be after the start.';
  if (u < now.getTime()) return 'The window has already ended.';
  return null;
}
