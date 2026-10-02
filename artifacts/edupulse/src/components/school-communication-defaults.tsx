import { useState } from 'react';
import { useGetSchoolCommunicationDefaults, useUpdateSchoolCommunicationDefaults } from '@workspace/api-client-react';
import type { SchoolCommunicationDefaults } from '@workspace/api-client-react';
const categories = ['ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT','ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'];
const channels = ['IN_APP','PUSH','SMS','EMAIL'] as const;
export function SchoolCommunicationDefaultsControl({ schoolId }: { schoolId: number }) {
  const query = useGetSchoolCommunicationDefaults(schoolId);
  const save = useUpdateSchoolCommunicationDefaults();
  const [draft, setDraft] = useState<SchoolCommunicationDefaults | null>(null);
  const [notice, setNotice] = useState('');
  const defaults = draft ?? query.data?.defaults ?? {};
  return <section className="panel space-y-4 p-5" aria-label="School channel defaults">
    <h2 className="display-font text-xl font-bold">School channel defaults</h2>
    <p className="text-sm">Default channels for existing school events. Delivery still requires a configured provider and the recipient’s preferences. Mandatory security preferences cannot be disabled.</p>
    {query.isLoading ? <p>Loading defaults…</p> : query.isError ? <p role="alert">Could not load defaults.</p> :
      <div className="space-y-3">{categories.map(category => <fieldset key={category} className="rounded-xl border p-3">
        <legend className="px-1 text-sm font-bold">{category}</legend><div className="flex flex-wrap gap-4">
          {channels.map(channel => <label key={channel} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" disabled={!query.data?.canWrite || save.isPending} checked={defaults[category]?.includes(channel) ?? false}
              onChange={e => setDraft({ ...defaults, [category]: e.target.checked ? [...(defaults[category] ?? []), channel] :
                (defaults[category] ?? []).filter(c => c !== channel) })} />{channel.replace('_',' ')}
          </label>)}</div>
      </fieldset>)}</div>}
    {query.data?.canWrite && <button type="button" disabled={!draft || save.isPending} className="min-h-11 rounded-lg border px-4 disabled:opacity-50"
      onClick={() => void save.mutateAsync({ schoolId, data: defaults }).then(async () => {
        await query.refetch(); setDraft(null); setNotice('School defaults saved.');
      }).catch(() => setNotice('Could not save defaults.'))}>Save school defaults</button>}
    {notice && <p role="status">{notice}</p>}
    <p className="text-xs">SMS, email and push configuration is managed securely outside this form. Saving a selection does not activate a provider.</p>
  </section>;
}