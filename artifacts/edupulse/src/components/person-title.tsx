import { PersonTitle } from '@workspace/api-client-react';
import { Field } from '@/components/shared';

export function PersonTitleField({ value, onChange }: {
  value: PersonTitle;
  onChange: (value: PersonTitle) => void;
}) {
  return <Field label="Title (optional)">
    <select aria-label="Person title" value={value ?? ''}
      onChange={event => onChange(event.target.value ? event.target.value as PersonTitle : null)}>
      <option value="">No title</option>
      {Object.values(PersonTitle).filter((title): title is NonNullable<PersonTitle> => typeof title === 'string')
        .map(title => <option key={title} value={title}>{title}</option>)}
    </select>
    <div role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p><strong>Title storage requires migration 0168_person_titles.sql.</strong> A selected title can only be saved after that reviewed addition has been safely applied to this environment.</p>
      <p>Until then, choose <strong>No title</strong> to save other details. Selecting a title here does not mean it has been saved; if storage is unavailable, the server rejects the save without changing the record.</p>
      <p className="mt-1">Titles stay separate from names. Do not add the title to the name as a workaround.</p>
    </div>
  </Field>;
}

export function personDisplayName(title: string | null | undefined, ...names: Array<string | null | undefined>) {
  return [title, ...names].filter(Boolean).join(' ');
}

export function personSaveError(error: unknown) {
  const body = (error as { data?: { error?: unknown } } | null)?.data;
  if (typeof body?.error === 'string') return body.error;
  return error instanceof Error ? error.message : 'Could not save this record. Check the fields and try again.';
}
