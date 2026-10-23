import { useState } from 'react';
import { useGetSchoolCommunicationDefaults, useUpdateSchoolCommunicationDefaults } from '@workspace/api-client-react';
import type { SchoolCommunicationDefaults } from '@workspace/api-client-react';
const categories = ['ATTENDANCE_ENTRY','ATTENDANCE_EXIT','ATTENDANCE_ABSENCE','NFC_REMINDER','EMERGENCY','ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT','ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'];
const channels = ['IN_APP','PUSH','SMS','EMAIL','TELEGRAM'] as const;
export function SchoolCommunicationDefaultsControl({ schoolId }: { schoolId: number }) {
  const query = useGetSchoolCommunicationDefaults(schoolId);
  const save = useUpdateSchoolCommunicationDefaults();
  const [draft, setDraft] = useState<SchoolCommunicationDefaults | null>(null);
  const [notice, setNotice] = useState('');
  const defaults = draft ?? query.data?.defaults ?? {};
  const selected = (category: string) =>
    (defaults[category] ?? query.data?.effectiveDefaults?.[category] ?? [])
      .filter(channel => query.data?.allowed?.[category]?.includes(channel));
  return <section className="panel space-y-4 p-5" aria-label="School channel defaults">
    <h2 className="display-font text-xl font-bold">School channel defaults</h2>
    <p className="text-sm">Checked channels are effective selections, not delivered messages. Events without a school override inherit the Owner defaults; an empty selection disables channels for that event. Owner restrictions always apply. Delivery also requires provider readiness and the recipient’s applicable preferences and consent.</p>
    {query.isLoading ? <p>Loading defaults…</p> : query.isError ? <p role="alert">Could not load defaults.</p> :
      <div className="space-y-3">{categories.map(category => <fieldset key={category} className="rounded-xl border p-3">
        <legend className="px-1 text-sm font-bold">{category}</legend><div className="flex flex-wrap gap-4">
          {channels.map(channel => <label key={channel} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" disabled={!query.data?.canWrite || save.isPending ||
              (!selected(category).includes(channel) && (!query.data?.availability?.[channel] || !query.data?.allowed?.[category]?.includes(channel)))}
              checked={selected(category).includes(channel)}
              onChange={e => {setDraft({ ...defaults, [category]: e.target.checked ? [...selected(category), channel] :
                selected(category).filter(c => c !== channel) });}} />{channel.replace('_',' ')}
            {!query.data?.allowed?.[category]?.includes(channel) ? <span className="text-xs">Owner restricted</span> :
              !query.data?.availability?.[channel] ? <span className="text-xs">Permitted, not yet deliverable</span> : null}
          </label>)}</div>
      </fieldset>)}</div>}
    {query.data?.canWrite && <button type="button" disabled={save.isPending} className="min-h-11 rounded-lg border px-4"
      onClick={()=>{const cleaned = { ...defaults };
        for (const event of categories) {
          const before = defaults[event] ?? query.data?.effectiveDefaults?.[event] ?? [];
          const after = before.filter(c=>query.data?.availability?.[c]&&query.data?.allowed?.[event]?.includes(c));
          if (after.length !== before.length) cleaned[event] = after;
        }
        setDraft(cleaned);
        setNotice('Blocked or unavailable selections removed from the draft. Save to confirm.');}}>Clear blocked selections</button>}
    {query.data?.canWrite && <button type="button" disabled={!draft || save.isPending} className="min-h-11 rounded-lg border px-4 disabled:opacity-50"
      onClick={() => void save.mutateAsync({ schoolId, data: defaults }).then(async () => {
        await query.refetch(); setDraft(null); setNotice('School defaults saved.');
      }).catch(() => setNotice('Could not save defaults.'))}>Save school defaults</button>}
    {notice && <p role="status">{notice}</p>}
    <p className="text-xs">SMS, email and push configuration is managed securely outside this form. Saving a selection does not activate a provider.</p>
  </section>;
}