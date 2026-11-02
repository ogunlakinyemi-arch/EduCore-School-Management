import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

export type AuditFilterOption = { value: string; label: string };

/** Search changes the choices only; selecting a choice changes the audit filter. */
export function AuditFilterSelect({ label, value, options, allLabel, loading, error, onRetry, onChange }: {
  label: string; value: string; options: AuditFilterOption[]; allLabel: string;
  loading: boolean; error: boolean; onRetry: () => void; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  const choose = (next: string) => { onChange(next); setOpen(false); };
  const id = label.toLowerCase();
  return <div className="min-w-0 text-sm">
    <span id={`audit-${id}-label`}>{label}</span>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} aria-label={label}
          data-testid={`select-audit-${id}`} disabled={loading}
          className="mt-1 flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-left disabled:opacity-60">
          <span className="min-w-0 truncate">{loading ? `Loading ${id}s…` : selected?.label ?? (value ? `${label} #${value}` : allLabel)}</span>
          <ChevronsUpDown size={16} className="shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput aria-label={`Search ${id}s`} placeholder={`Search ${id}s…`} />
          <CommandList aria-label={`${label} options`} className="max-h-64">
            <CommandEmpty>No matching {id}s.</CommandEmpty>
            <CommandGroup>
              <CommandItem forceMount value={allLabel} onSelect={() => choose('')} className="min-h-11">
                <Check size={16} className={`mr-2 shrink-0 ${value ? 'invisible' : ''}`} aria-hidden="true" />{allLabel}
              </CommandItem>
              {options.map(option => <CommandItem key={option.value} value={option.label} onSelect={() => choose(option.value)}
                className="min-h-11 items-start">
                <Check size={16} className={`mr-2 mt-0.5 shrink-0 ${value === option.value ? '' : 'invisible'}`} aria-hidden="true" />
                <span className="min-w-0 break-words">{option.label}</span>
              </CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    {error && <p role="alert" className="mt-1 text-xs text-[hsl(var(--destructive))]">
      Could not load {id}s. <button type="button" className="min-h-11 underline" onClick={onRetry}>Retry {id}s</button>
    </p>}
  </div>;
}
