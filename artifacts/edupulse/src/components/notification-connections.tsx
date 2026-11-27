import { WebPushControl } from './web-push-control';
import { ParentTelegramControl } from './telegram-control';

/** Transport setup/withdrawal is consent, not a category/channel preference. */
export function NotificationConnections({ schoolId, parent = false, teacher = false }: {
  schoolId?: number | null; parent?: boolean; teacher?: boolean;
}) {
  return <details className="panel my-4 p-4">
    <summary className="cursor-pointer text-sm font-bold">Connect this device{parent || teacher ? ' or Telegram' : ''}</summary>
    <WebPushControl schoolId={schoolId && schoolId > 0 ? schoolId : null} />
    {!!schoolId && (parent || teacher) && <ParentTelegramControl schoolId={schoolId} teacher={teacher} />}
  </details>;
}
