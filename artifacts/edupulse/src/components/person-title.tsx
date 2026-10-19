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
    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Stored separately from the name. Selecting a title requires the approved database addition.</p>
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
