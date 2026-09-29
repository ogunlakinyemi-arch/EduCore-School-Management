import type { CommunicationCategory, CommunicationDelivery, CommunicationNotification, CommunicationNotificationInbox, CommunicationPushDevice } from '@workspace/api-client-react';

export type ComposeRole = 'admin' | 'teacher' | 'accountant';

/** Manual campaigns are not authoritative lifecycle notifications. */
export function manualCategory(role: ComposeRole): CommunicationCategory {
  return role === 'accountant' ? 'FINANCE' : 'ANNOUNCEMENT';
}

export function isSimulatedDelivery(delivery: Pick<CommunicationDelivery, 'errorCode' | 'provider'>): boolean {
  return delivery.errorCode === 'SIMULATED'
    || ['dev-test', 'development-sms', 'development-email'].includes(delivery.provider ?? '');
}

export function deliveryStatusLabel(delivery: Pick<CommunicationDelivery, 'status' | 'errorCode' | 'provider'>): string {
  if (isSimulatedDelivery(delivery) && ['SENT', 'DELIVERED', 'READ'].includes(delivery.status)) return 'Simulated send';
  return delivery.status;
}

export function campaignStatusLabel(status: string): string {
  return status === 'SENT' ? 'Processed' : status;
}

// `origin` is being added to the generated client contract. Keep this structural type
// compatible with both the currently generated schema and the incoming required field.
export function visibleCommunicationNotifications<T extends CommunicationNotification & { origin?: 'CAMPAIGN' | 'SYSTEM' }>(items: T[]): T[] {
  return items.filter(item => !(item.origin === 'SYSTEM' && (item.category === 'FINANCE' || item.category === 'PAYMENT')));
}

// Keep the generated response contracts explicit: inbox is paginated; push devices are a bare list.
export function inboxItems(response: CommunicationNotificationInbox | undefined) { return response?.items ?? []; }
export function pushDevices(response: CommunicationPushDevice[] | undefined) { return response ?? []; }