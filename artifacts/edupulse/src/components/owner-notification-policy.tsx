import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetNotificationChannelPolicy, getGetNotificationChannelPolicyQueryKey,
  useUpdateNotificationChannelPolicy, type NotificationChannelPolicy,
} from '@workspace/api-client-react';
import { Button, ErrorState } from './shared';

const channels = ['EMAIL', 'SMS'] as const;
const smsEvents = new Set(['EMERGENCY', 'ATTENDANCE_ABSENCE', 'FINANCE', 'NFC_REMINDER']);

export function OwnerNotificationPolicyControl() {
  const qc = useQueryClient();
  const query = useGetNotificationChannelPolicy({ query: {
    queryKey: getGetNotificationChannelPolicyQueryKey(), refetchInterval: 30000,
  } });
  const [draft, setDraft] = useState<NotificationChannelPolicy | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const save = useUpdateNotificationChannelPolicy({ request: {
    headers: { 'X-Notification-Policy-Reason': reason.trim() },
  } });
  const policy = draft ?? query.data?.policy;
  const change = (event: string, channel: typeof channels[number], checked: boolean) => {
    if (!policy) return;
    const rule = policy.events[event];
    setDraft({ ...policy, events: { ...policy.events, [event]: {
      ...rule,
      allowed: checked ? [...new Set([...rule.allowed, channel])] : rule.allowed.filter(c => c !== channel),
      defaults: checked ? [...new Set([...rule.defaults, channel])] : rule.defaults.filter(c => c !== channel),
    } } });
    setNotice('');
  };
  const submit = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync({ data: draft });
      setDraft(null); setReason(''); setNotice('Notification choices saved.');
      await qc.invalidateQueries({ queryKey: getGetNotificationChannelPolicyQueryKey() });
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not save. Refresh before trying again.'); }
  };
  return <section className="panel max-w-4xl space-y-4 p-5" aria-label="Platform notification policy">
    <p className="text-sm">Push, in-app and Telegram are standard for everyone, including reminders. Delivery still requires permission, consent and channel setup; existing holds remain in place.</p>
    {query.isLoading ? <p>Loading…</p> : query.isError ? <ErrorState retry={() => void query.refetch()} /> : policy && <>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <caption className="sr-only">Email and SMS by notification event</caption>
        <thead><tr className="text-left"><th className="py-2">Event</th>{channels.map(c => <th key={c} className="px-3">{c === 'EMAIL' ? 'Email' : 'SMS'}</th>)}</tr></thead>
        <tbody>{Object.entries(policy.events).map(([event, rule]) => <tr key={event} className="border-t">
          <th scope="row" className="py-3 text-left font-medium capitalize">{event.toLowerCase().replaceAll('_', ' ')}</th>
          {channels.map(channel => {
            const checked = rule.allowed.includes(channel) && rule.defaults.includes(channel);
            const supported = channel !== 'SMS' || smsEvents.has(event);
            const ready = query.data?.availability[channel] === true;
            return <td key={channel} className="px-3"><input type="checkbox"
              aria-label={`${event} ${channel}`} checked={checked} disabled={save.isPending || !supported || (!ready && !checked)}
              onChange={e => change(event, channel, e.target.checked)} /></td>;
          })}
        </tr>)}</tbody>
      </table></div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Unavailable channels cannot be newly selected. SMS remains limited to approved events and opted-in recipients.</p>
      <label className="block text-sm">Reason for change
        <input className="mt-1 w-full rounded-lg border bg-transparent p-2" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={save.isPending} />
      </label>
      <Button disabled={!draft || save.isPending || reason.trim().length < 5}
        onClick={() => void submit()}>Save Email and SMS</Button>
    </>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
