import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarX2, Plus, Trash2 } from 'lucide-react';
import {
  useGetSchoolAttendanceSchedule, useUpdateSchoolAttendanceSchedule, useAssessSchoolAttendance,
  getGetSchoolAttendanceScheduleQueryKey,
} from '@workspace/api-client-react';
import type { SchoolAttendanceSchedule, SchoolAttendanceScheduleRules } from '@workspace/api-client-react';
import { Button, Field } from '@/components/shared';

const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const TIMES: [keyof SchoolAttendanceSchedule, string][] = [
  ['arrivalStart', 'Arrival opens'], ['arrivalEnd', 'Arrival closes'], ['lateCutoff', 'Late after'],
  ['absenceAssessment', 'Absence review runs at'], ['weekdaysClosing', 'Weekday school closing'], ['fridayClosing', 'Friday school closing'],
  ['missingTagOutStart', 'Missing tag-out window opens'], ['missingTagOutEnd', 'Missing tag-out window ends'],
  ['fridayMissingTagOut', 'Friday missing tag-out check'], ['classroomDeadline', 'Classroom presence deadline'],
];
const CLOSING_KEYS = new Set<keyof SchoolAttendanceSchedule>([
  'weekdaysClosing', 'fridayClosing', 'missingTagOutStart', 'missingTagOutEnd', 'fridayMissingTagOut',
]);
const RULES: [keyof SchoolAttendanceScheduleRules, string, string][] = [
  ['entryEnabled', 'Gate entry', 'Accept Tag-in at the gate.'],
  ['exitEnabled', 'Gate exit', 'Accept Tag-out; exit never removes class presence.'],
  ['lateness', 'Lateness', 'Mark arrivals after the late cutoff as late.'],
  ['absenceReview', 'Absence review', 'Create review items for students with no record. This is not a physical absence finding.'],
  ['classroomAnomalies', 'Classroom anomalies', 'Flag gate/classroom mismatches for review.'],
  ['missingTagOut', 'Missing tag-out', 'Flag students with entry but no exit after closing.'],
  ['offlineSync', 'Offline sync', 'Accept queued device events within the offline limit.'],
  ['notifications', 'Notifications', 'Allow attendance notifications to be queued under school rules.'],
  ['allowEarlyExit', 'Early exit', 'Allow exit before closing time.'],
  ['allowReentry', 'Re-entry', 'Allow a student to re-enter after exiting.'],
  ['provisionalClassPresence', 'Provisional class presence', 'Morning NFC tag-in records NFC_GATE_AUTO class presence. Not biometric.'],
];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function errMsg(e: unknown): string {
  const x = e as any;
  return x?.data?.error || x?.data?.message || x?.response?.data?.error || x?.message || 'Request failed.';
}

export function validateSchedule(s: SchoolAttendanceSchedule, reason: string): string[] {
  const out: string[] = [];
  if (!s.timezone.trim()) out.push('Timezone is required.');
  if (!s.operatingDays.length) out.push('Select at least one operating day.');
  for (const [key, label] of TIMES) if (!TIME_RE.test(String(s[key]))) out.push(`${label} must be a valid time.`);
  if (!Number.isInteger(s.duplicateSeconds) || s.duplicateSeconds < 5 || s.duplicateSeconds > 600) out.push('Duplicate window must be 5–600 seconds.');
  if (!Number.isInteger(s.offlineMaxHours) || s.offlineMaxHours < 1 || s.offlineMaxHours > 8784) out.push('Offline limit must be 1–8784 hours.');
  s.closures.forEach((c, i) => { if (!DATE_RE.test(c.date) || c.reason.trim().length < 1) out.push(`Closure ${i + 1} needs a date and reason.`); });
  s.exemptions.forEach((x, i) => {
    if (!Number.isInteger(x.studentId) || x.studentId < 1 || !DATE_RE.test(x.from) || !DATE_RE.test(x.to) || !x.reason.trim()) out.push(`Exemption ${i + 1} needs student ID, dates and reason.`);
    else if (x.from > x.to) out.push(`Exemption ${i + 1} ends before it starts.`);
  });
  if (reason.trim().length < 3) out.push('Reason for change must be at least 3 characters.');
  return out;
}

export function SchoolAttendanceSchedulePanel({ schoolId, canEdit }: { schoolId: number; canEdit: boolean }) {
  const cache = useQueryClient();
  const params = { schoolId };
  const query = useGetSchoolAttendanceSchedule(params, { query: { enabled: !!schoolId, queryKey: getGetSchoolAttendanceScheduleQueryKey(params) } as any });
  const update = useUpdateSchoolAttendanceSchedule();
  const assess = useAssessSchoolAttendance();
  const [draft, setDraft] = useState<SchoolAttendanceSchedule | null>(null);
  const [reason, setReason] = useState('');
  const [initKey, setInitKey] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [assessMsg, setAssessMsg] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const activeSchool = useRef(schoolId);
  activeSchool.current = schoolId;

  const view = query.data as { schedule: SchoolAttendanceSchedule; revision: number; precedence: string[] } | undefined;
  const server = useMemo(() => (view ? JSON.stringify(view.schedule) : ''), [view]);
  const dirty = !!draft && JSON.stringify(draft) !== server;

  // Re-initialise on tenant or revision change; never clobber in-progress edits on same revision.
  const key = view ? `${schoolId}:${view.revision}` : '';
  useEffect(() => {
    if (view && key !== initKey) {
      setInitKey(key); setDraft(structuredClone(view.schedule)); setReason(''); setSaved(false); setSaveError(''); setShowErrors(false); setAssessMsg(''); setCursor(null);
    }
  }, [view, key, initKey]);

  if (query.isLoading) return <div className="panel p-6 text-sm text-[hsl(var(--muted-foreground))]" role="status">Loading attendance schedule…</div>;
  if (query.isError) return <div role="alert" data-testid="error-attendance-schedule"
    className="rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] p-5 text-sm text-[hsl(var(--destructive))]">
    <p className="font-semibold">Attendance schedule could not be loaded for the selected school.</p>
    <p className="mt-2">Retry loading. If the problem continues, ask your School Admin to review the saved schedule and your access to this school.</p>
    <Button variant="outline" onClick={() => void query.refetch()} testId="button-retry-attendance-schedule">Retry loading schedule</Button>
  </div>;
  if (!view || !draft || initKey !== key) return <div className="panel p-6 text-sm" role="status">Loading attendance schedule…</div>;

  const errors = validateSchedule(draft, reason);
  const set = <K extends keyof SchoolAttendanceSchedule>(k: K, v: SchoolAttendanceSchedule[K]) => { setDraft({ ...draft, [k]: v }); setSaved(false); };
  const ro = !canEdit;

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (ro) return;
    setShowErrors(true); setSaveError('');
    if (errors.length) return;
    const target = schoolId;
    update.mutate({ params: { schoolId: target }, data: { schedule: draft, revision: view.revision, reason: reason.trim() } }, {
      onSuccess: () => {
        void cache.invalidateQueries({ queryKey: getGetSchoolAttendanceScheduleQueryKey({ schoolId: target }) });
        if (activeSchool.current === target) { setSaved(true); setReason(''); setShowErrors(false); }
      },
      onError: (err) => { if (activeSchool.current === target) setSaveError(errMsg(err)); },
    });
  };
  const runAssess = (after: number) => {
    const target = schoolId; setAssessMsg('');
    assess.mutate({ params: { schoolId: target }, data: { afterStudentId: after } }, {
      onSuccess: r => {
        if (activeSchool.current !== target) return;
        setCursor(r.nextAfterStudentId);
        setAssessMsg(`${r.date}: reviewed ${r.reviewed}, created ${r.created} review item(s).${r.nextAfterStudentId != null ? ' More students remain.' : ' Complete.'}`);
      },
      onError: err => { if (activeSchool.current === target) setAssessMsg(`Assessment failed: ${errMsg(err)}`); },
    });
  };
  const box = 'rounded-lg border border-[hsl(var(--border))] p-3';

  return (
    <form onSubmit={save} className="space-y-5" aria-label="School attendance schedule" data-testid="form-attendance-schedule">
      <div className="panel space-y-2 p-5 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-bold">School attendance schedule and rules</h2>
          <span className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="text-schedule-revision">Revision {view.revision}</span>
          {dirty && <span className="rounded-full bg-[hsl(var(--accent)/.25)] px-2 py-0.5 text-xs font-bold" data-testid="status-schedule-dirty">Unsaved changes</span>}
        </div>
        {view.revision === 0 && <p role="status" data-testid="text-schedule-unconfigured">No attendance schedule has been saved for this school. These are suggested defaults; review and save them to configure the schedule.</p>}
        {ro && <p role="status" data-testid="text-schedule-readonly">Read-only. Only the School Admin can change this school's schedule; Platform Owner access is read-only.</p>}
        <p><strong>Precedence:</strong> <span data-testid="text-precedence">{view.precedence.join(' → ')}</span></p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-[hsl(var(--muted-foreground))]">
          <li>Absence review items mean no attendance record was found; they are not proof of physical absence until reviewed.</li>
          <li>Approved corrections are authoritative and override automatic assessment.</li>
          <li>Offline events with ambiguous timing require review before they count.</li>
          <li>NFC gate tap gives provisional class presence only; it is not biometric confirmation.</li>
          <li>Exit after school closing is state-based on the student's current presence, not alternating taps.</li>
        </ul>
      </div>

      <fieldset disabled={ro} className="panel min-w-0 space-y-3 p-5">
        <legend className="eyebrow px-1">Closing times and missing tag-out review</legend>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Times use {draft.timezone}. A missing tag-out creates a review item; it never proves physical absence.</p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TIMES.filter(([key]) => CLOSING_KEYS.has(key)).map(([key, label]) => <Field key={key} label={label}>
            <input type="time" step={60} aria-label={label} value={String(draft[key]).slice(0, 5)} onChange={e => set(key, e.target.value as never)} />
          </Field>)}
        </div>
      </fieldset>
      <fieldset disabled={ro} className="panel min-w-0 space-y-4 p-5">
        <legend className="eyebrow px-1">Calendar and times</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Timezone"><input value={draft.timezone} onChange={e => set('timezone', e.target.value)} placeholder="Africa/Lagos" /></Field>
          {TIMES.filter(([key]) => !CLOSING_KEYS.has(key)).map(([k, label]) => <Field key={k} label={label}><input type="time" step={60} aria-label={label} value={String(draft[k]).slice(0, 5)} onChange={e => set(k, e.target.value as never)} /></Field>)}
          <Field label="Duplicate tap window (seconds)"><input type="number" min={5} max={600} value={draft.duplicateSeconds} onChange={e => set('duplicateSeconds', Number(e.target.value))} /></Field>
          <Field label="Offline event limit (hours)"><input type="number" min={1} max={8784} value={draft.offlineMaxHours} onChange={e => set('offlineMaxHours', Number(e.target.value))} /></Field>
        </div>
        <div role="group" aria-label="Operating days" className="flex flex-wrap gap-2">
          {DAYS.map(([n, label]) => (
            <label key={n} className={`${box} flex cursor-pointer items-center gap-2 text-sm`}>
              <input type="checkbox" className="!w-auto" checked={draft.operatingDays.includes(n)} aria-label={`Operating day ${label}`}
                onChange={e => set('operatingDays', e.target.checked ? [...draft.operatingDays, n].sort() : draft.operatingDays.filter(d => d !== n))} />{label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={ro} className="panel p-5">
        <legend className="eyebrow px-1">Rules</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {RULES.map(([k, label, hint]) => (
            <label key={k} className={`${box} flex items-start gap-3 text-sm`}>
              <input type="checkbox" className="mt-1 !w-auto" checked={draft.rules[k]} aria-label={label}
                onChange={e => set('rules', { ...draft.rules, [k]: e.target.checked })} />
              <span><strong className="block">{label}</strong><span className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={ro} className="panel space-y-3 p-5">
        <legend className="eyebrow px-1">Closures and holidays</legend>
        {!draft.closures.length && <p className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]"><CalendarX2 size={15} />No closures set.</p>}
        {draft.closures.map((c, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[10rem_1fr_auto]">
            <Field label="Closure date"><input type="date" value={c.date} onChange={e => set('closures', draft.closures.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} /></Field>
            <Field label="Closure reason"><input value={c.reason} onChange={e => set('closures', draft.closures.map((x, j) => j === i ? { ...x, reason: e.target.value } : x))} /></Field>
            <button type="button" aria-label={`Remove closure ${i + 1}`} className="grid h-10 w-10 place-items-center rounded-lg border" onClick={() => set('closures', draft.closures.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
          </div>
        ))}
        <Button variant="outline" disabled={ro} onClick={() => set('closures', [...draft.closures, { date: '', reason: '' }])}><Plus size={14} />Add closure</Button>
      </fieldset>

      <fieldset disabled={ro} className="panel space-y-3 p-5">
        <legend className="eyebrow px-1">Student exemptions</legend>
        {!draft.exemptions.length && <p className="text-sm text-[hsl(var(--muted-foreground))]">No exemptions set.</p>}
        {draft.exemptions.map((x, i) => {
          const upd = (p: Partial<typeof x>) => set('exemptions', draft.exemptions.map((y, j) => j === i ? { ...y, ...p } : y));
          return (
            <div key={i} className="grid min-w-0 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[7rem_9rem_9rem_minmax(0,1fr)_auto]">
              <Field label="Student ID"><input type="number" min={1} value={x.studentId || ''} onChange={e => upd({ studentId: Number(e.target.value) })} /></Field>
              <Field label="Exempt from"><input type="date" value={x.from} onChange={e => upd({ from: e.target.value })} /></Field>
              <Field label="Exempt to"><input type="date" value={x.to} onChange={e => upd({ to: e.target.value })} /></Field>
              <Field label="Exemption reason"><input value={x.reason} onChange={e => upd({ reason: e.target.value })} /></Field>
              <button type="button" aria-label={`Remove exemption ${i + 1}`} className="grid h-10 w-10 place-items-center rounded-lg border" onClick={() => set('exemptions', draft.exemptions.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
            </div>
          );
        })}
        <Button variant="outline" disabled={ro} onClick={() => set('exemptions', [...draft.exemptions, { studentId: 0, from: '', to: '', reason: '' }])}><Plus size={14} />Add exemption</Button>
      </fieldset>

      {!ro && (
        <div className="panel space-y-3 p-5">
          <Field label="Reason for change (required)"><textarea value={reason} minLength={3} maxLength={500} onChange={e => { setReason(e.target.value); setSaved(false); }} placeholder="Why is this schedule changing?" /></Field>
          {showErrors && errors.length > 0 && <ul role="alert" className="list-disc pl-5 text-sm text-[hsl(var(--destructive))]" data-testid="list-schedule-errors">{errors.map(m => <li key={m}>{m}</li>)}</ul>}
          {saveError && <p role="alert" className="text-sm text-[hsl(var(--destructive))]" data-testid="text-save-error">Could not save: {saveError}</p>}
          {saved && !dirty && <p role="status" className="text-sm" data-testid="text-save-success">Schedule saved.</p>}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={update.isPending || !dirty} testId="button-save-schedule">{update.isPending ? 'Saving…' : 'Save schedule'}</Button>
            <Button variant="outline" disabled={!dirty || update.isPending} onClick={() => { setDraft(structuredClone(view.schedule)); setReason(''); setShowErrors(false); setSaveError(''); }}>Discard changes</Button>
          </div>
        </div>
      )}

      {!ro && (
        <div className="panel space-y-3 p-5">
          <h3 className="text-sm font-bold">Run absence review</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Creates review items for students with no attendance record today. It does not mark anyone physically absent.</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" disabled={assess.isPending || dirty} onClick={() => runAssess(0)} testId="button-run-assessment">{assess.isPending ? 'Reviewing…' : 'Run review'}</Button>
            {cursor != null && <Button variant="outline" disabled={assess.isPending} onClick={() => runAssess(cursor)} testId="button-continue-assessment">Continue next batch</Button>}
          </div>
          {dirty && <p className="text-xs">Save schedule changes before running a review.</p>}
          {assessMsg && <p role="status" className="text-sm" data-testid="text-assess-result">{assessMsg}</p>}
        </div>
      )}
    </form>
  );
}
