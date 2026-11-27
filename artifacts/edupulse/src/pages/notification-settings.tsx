import { PageHeading, useSchoolAdminAccess } from '@/components/shared';
import { OwnerNotificationPolicyControl } from '@/components/owner-notification-policy';

/** One central page, never an individual's delivery/consent settings. */
export function NotificationSettings() {
  const access = useSchoolAdminAccess();
  if (!access.isPlatformOwner) return null;
  return <div className="fade-up">
    <PageHeading eyebrow="Platform settings" title="Notifications" />
    <OwnerNotificationPolicyControl />
  </div>;
}
