export const COMMUNITY_AUDIENCES = ['TEACHER', 'STUDENT', 'PARENT', 'STAFF', 'DRIVER'] as const;
export type CommunityAudience = typeof COMMUNITY_AUDIENCES[number];
export const audienceLabel = (v: string) => v.charAt(0) + v.slice(1).toLowerCase();
export const isAllCommunity = (a: readonly string[]) => COMMUNITY_AUDIENCES.every(x => a.includes(x));

export function AudiencePicker({ value, onChange, legend = 'Audience' }: { value: CommunityAudience[]; onChange: (v: CommunityAudience[]) => void; legend?: string }) {
  const all = isAllCommunity(value);
  return (
    <fieldset data-testid="audience-picker"><legend className="mb-1.5 text-xs font-bold text-[hsl(var(--muted-foreground))]">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" className="!w-auto" checked={all} data-testid="audience-all" onChange={e => onChange(e.target.checked ? [...COMMUNITY_AUDIENCES] : [])} />All community</label>
        {COMMUNITY_AUDIENCES.map(a => (
          <label key={a} className="flex items-center gap-2 text-sm"><input type="checkbox" className="!w-auto" checked={value.includes(a)} data-testid={`audience-${a}`}
            onChange={e => onChange(e.target.checked ? [...value, a] : value.filter(x => x !== a))} />{audienceLabel(a)}</label>
        ))}
      </div>
    </fieldset>
  );
}
