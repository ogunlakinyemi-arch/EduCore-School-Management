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
  if(delivery.errorCode==='PROVIDER_OUTCOME_UNKNOWN')return 'Outcome unknown · held';
  if(delivery.status==='QUEUED'&&delivery.errorCode==='TELEGRAM_WAITING_FOR_LINK')return 'Waiting for your Telegram connection';
  if(delivery.status==='QUEUED'&&delivery.errorCode==='TELEGRAM_UNAVAILABLE')return 'Waiting for Telegram service recovery';
  if(['NOTICE_EXPIRED_OR_CANCELLED','TIMETABLE_CHANGED_OR_EXPIRED'].includes(delivery.errorCode??''))return 'Expired or no longer current';
  if(delivery.status==='SENT')return 'Accepted · delivery not confirmed';
  if(delivery.status==='DELIVERED')return 'Delivered';
  if(delivery.status==='QUEUED')return 'Queued · not sent';
  return delivery.status;
}

export function deliveryNextAction(delivery:Pick<CommunicationDelivery,'status'|'errorCode'|'provider'>){
  if(delivery.errorCode==='PROVIDER_OUTCOME_UNKNOWN')return 'Do not resend. The Owner must reconcile the provider outcome first.';
  if(delivery.status==='QUEUED'&&delivery.errorCode==='TELEGRAM_WAITING_FOR_LINK')
    return 'Connect your own Telegram account in Preferences and confirm it while signed in. Only current eligible unsent work can resume.';
  if(delivery.status==='QUEUED'&&delivery.errorCode==='TELEGRAM_UNAVAILABLE')
    return 'Wait for service recovery. The authorized worker will recheck current permissions; no send was attempted.';
  if(delivery.errorCode==='RATE_LIMITED')return 'Wait for a scheduled retry within the retry limits, or ask the Owner if held. Do not create a duplicate notice.';
  if(['NOTICE_EXPIRED_OR_CANCELLED','TIMETABLE_CHANGED_OR_EXPIRED'].includes(delivery.errorCode??''))
    return 'This delivery will not resume. The original inbox record remains available.';
  if(delivery.status==='CANCELLED')return 'Not automatically resumed. Check current preferences and school permission; reconnection does not revive cancelled work.';
  if(delivery.status==='FAILED')return 'Delivery failed. Only a proven retryable failure can be retried; check with the Owner if it remains held.';
  return null;
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

export function inboxArchiveView<T extends { isArchived: boolean }>(items: T[], archived: boolean): T[] {
  return items.filter(item => item.isArchived === archived);
}

export function canArchiveNotification(category: string): boolean {
  return !['ACCOUNT', 'SECURITY'].includes(category);
}