import type { ReactNode } from 'react';
import { BellRing, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/shared';
import { smsExclusion, type FieldSmsController } from '@/hooks/use-field-sms-controller';

const muted = 'text-[hsl(var(--muted-foreground))]';

/** Toolbar above the visited list. Selects only server-eligible visible rows; never sends. */
export function FieldReminderToolbar({ sms, visibleIds }: { sms: FieldSmsController; visibleIds: number[] }) {
  const ready = !!sms.data && !sms.query.isError;
  const eligibleVisible = ready ? visibleIds.filter(sms.sendable) : [];
  const selectedVisible = eligibleVisible.filter(id => sms.picked.has(id));
  const allOn = eligibleVisible.length > 0 && selectedVisible.length === eligibleVisible.length;
  const count = sms.all ? (sms.data?.leads.filter(l => l.eligible && l.allowed).length ?? 0) : [...sms.picked].filter(sms.sendable).length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.25)] px-4 py-3" data-testid="field-reminder-toolbar">
      <label className="flex items-center gap-2 text-xs font-bold">
        <input type="checkbox" className="!w-4 h-4" disabled={!eligibleVisible.length} checked={allOn}
          onChange={e => sms.setVisible(eligibleVisible, e.target.checked)} data-testid="check-field-select-visible"
          aria-label="Select all eligible visible schools" />
        Select eligible visible ({eligibleVisible.length} of {visibleIds.length})
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {!ready && <span className={`text-xs ${muted}`} data-testid="text-reminder-eligibility-unknown">
          {sms.query.isError ? 'Eligibility unavailable; see Field SMS above.' : 'Checking eligibility...'}</span>}
        <Button className="h-9 px-3 text-xs" disabled={!count} onClick={sms.focusComposer} testId="button-field-send-reminders">
          <BellRing size={14} />Send reminders ({count})
        </Button>
      </div>
    </div>
  );
}

/** Wraps the existing detail button; checkbox and actions are siblings, never nested. */
export function FieldLeadReminderRow({ sms, leadId, schoolName, children }: { sms: FieldSmsController; leadId: number; schoolName: string; children: ReactNode }) {
  const ready = !!sms.data && !sms.query.isError;
  const lead = sms.byId.get(leadId);
  const ok = ready && sms.sendable(leadId);
  const why = ready ? smsExclusion(lead) : '';
  const checked = ok && (sms.all || sms.picked.has(leadId));
  return (
    <div className="flex flex-wrap items-stretch sm:flex-nowrap" data-testid={`row-field-lead-${leadId}`}>
      <div className="flex items-start pl-4 pt-4">
        <input type="checkbox" className="!w-4 h-4" disabled={!ok || sms.all} checked={checked} onChange={() => sms.toggle(leadId)}
          aria-label={`Select ${schoolName} for reminder`} data-testid={`check-field-lead-${leadId}`} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex w-full flex-wrap items-center gap-2 px-4 pb-3 sm:w-auto sm:flex-col sm:items-end sm:justify-center sm:py-3">
        {ok ? <>
          <button type="button" className="text-xs font-bold underline" onClick={() => sms.remind(leadId)} data-testid={`button-field-remind-${leadId}`}>Send reminder</button>
          <button type="button" className="text-xs font-bold text-[hsl(var(--destructive))] underline" onClick={() => sms.openPermission(leadId, false)} data-testid={`button-field-optout-${leadId}`}>Opt out</button></>
          : ready && <>
            <span className={`text-xs ${muted}`} data-testid={`text-field-excluded-${leadId}`}>Excluded: {why}</span>
            {lead && !lead.allowed && <button type="button" className="flex items-center gap-1 text-xs font-bold underline" onClick={() => sms.openPermission(leadId)} data-testid={`button-field-record-permission-${leadId}`}><ShieldCheck size={12} />Record permission</button>}
          </>}
      </div>
    </div>
  );
}
