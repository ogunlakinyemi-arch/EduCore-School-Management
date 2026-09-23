import { useState, type FormEvent } from 'react';
import { Activity, AlertTriangle, ClipboardCheck, Clock3, Plus, RefreshCw } from 'lucide-react';
import {
  useGetSchoolAttendanceToday, useListSchoolAttendanceEvents, useListAttendanceDiscrepancies,
  useCreateManualAttendance, useCorrectAttendance,
  getGetSchoolAttendanceTodayQueryKey, getListSchoolAttendanceEventsQueryKey,
  getListAttendanceDiscrepanciesQueryKey,
  useGetAuthorizedContext,
} from '@workspace/api-client-react';
import type { AttendanceEventType, AttendanceStatus } from '@workspace/api-client-react';
import {
  Button, EmptyState, ErrorState, Field, Metric, Modal, PageHeading, SkeletonPage,
  StatusPill, TenantPicker, useTenant, cx, time,
} from '@/components/shared';

type Tab = 'events' | 'history' | 'reports' | 'discrepancies';

export function AttendancePage() {
  const { schoolId } = useTenant();
  const [tab, setTab] = useState<Tab>('events');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fromDate, setFromDate] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [eventType, setEventType] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [subject, setSubject] = useState<'all' | 'student' | 'employee'>('all');
  const [discrepancyStatus, setDiscrepancyStatus] = useState('');
  const [modal, setModal] = useState<'manual' | { correction: any } | null>(null);
  const contextQuery = useGetAuthorizedContext();
  const isPlatformOwner = contextQuery.data?.isPlatformOwner === true;
  const roles = contextQuery.data?.roles?.map(role => role.role) ?? [];
  const canWrite = isPlatformOwner || roles.includes('SCHOOL_ADMIN') || roles.includes('STAFF');

  const today = useGetSchoolAttendanceToday(
    { schoolId, date },
    { query: { enabled: !!schoolId, queryKey: getGetSchoolAttendanceTodayQueryKey({ schoolId, date }) } },
  );
  const eventFrom = tab === 'events' ? `${date}T00:00:00.000Z` : `${fromDate}T00:00:00.000Z`;
  const eventTo = tab === 'events' ? `${date}T23:59:59.999Z` : `${toDate}T23:59:59.999Z`;
  const events = useListSchoolAttendanceEvents(
    { schoolId, from: eventFrom, to: eventTo, eventType: eventType || undefined, status: status || undefined, identificationMethod: method || undefined } as any,
    { query: { enabled: !!schoolId && tab !== 'discrepancies', queryKey: getListSchoolAttendanceEventsQueryKey({ schoolId, from: eventFrom, to: eventTo, eventType: eventType || undefined, status: status || undefined, identificationMethod: method || undefined } as any) } },
  );
  const discrepancies = useListAttendanceDiscrepancies(
    { schoolId, status: discrepancyStatus || undefined, from: date, to: date } as any,
    { query: { enabled: !!schoolId && tab === 'discrepancies', queryKey: getListAttendanceDiscrepanciesQueryKey({ schoolId, status: discrepancyStatus || undefined, from: date, to: date } as any) } },
  );

  const refresh = () => {
    void today.refetch();
    void events.refetch();
    void discrepancies.refetch();
  };
  const summary: any = today.data;
  const rows: any[] = tab === 'discrepancies' ? ((discrepancies.data as any[]) ?? []) : ((events.data as any[]) ?? []).filter(row => subject === 'all' || (subject === 'student' ? row.studentId != null : row.employeeId != null));

  if (!schoolId) return <div className="fade-up"><PageHeading eyebrow="Operations / Attendance" title="Attendance, with context." description="Select a school to inspect attendance events and reconciliation." action={<TenantPicker />} /><EmptyState icon={ClipboardCheck} title="Select a school context" description="Platform owners can choose any active school; school users see their authorized school." /></div>;
  if (today.isLoading) return <SkeletonPage />;

  return (
    <div className="fade-up">
      <PageHeading eyebrow="Operations / Attendance" title="Attendance, with context." description="School entry, classroom presence, and reconciliation in one auditable view." action={<div className="flex items-center gap-3"><TenantPicker /><Button variant="outline" onClick={refresh}><RefreshCw size={15} />Refresh</Button>{canWrite && <Button onClick={() => setModal('manual')}><Plus size={15} />Record event</Button>}</div>} />
      {today.isError ? <ErrorState retry={() => today.refetch()} /> : (
        <>
          <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="School entries" value={summary?.entries ?? summary?.schoolEntries ?? 'Not available'} detail="Selected day" icon={ClipboardCheck} accent />
            <Metric label="School exits" value={summary?.exits ?? summary?.schoolExits ?? 'Not available'} detail="Selected day" icon={Activity} />
            <Metric label="Currently present" value={summary?.present ?? summary?.studentsPresent ?? 'Not available'} detail="From recorded events" icon={Clock3} accent />
            <Metric label="Discrepancies" value={summary?.discrepancies ?? summary?.mismatches ?? 'Not available'} detail="Requires review" icon={AlertTriangle} />
          </div>
          <div className="panel overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-[hsl(var(--border))] p-5 md:flex-row md:items-center md:justify-between">
              <div className="flex gap-1 rounded-xl bg-[hsl(var(--muted)/.45)] p-1">
                {(['events', 'history', 'reports', 'discrepancies'] as Tab[]).map(item => <button key={item} onClick={() => setTab(item)} className={cx('rounded-lg px-3 py-2 text-xs font-bold capitalize transition-colors', tab === item ? 'bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]')}>{item}</button>)}
              </div>
              <div className="flex flex-wrap gap-2">
                {tab === 'events' || tab === 'discrepancies' ? <label className="flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">School day <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="School day" /></label> : <><label className="flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">From <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} aria-label="History start date" /></label><label className="flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">To <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} aria-label="History end date" /></label></>}
                <select value={eventType} onChange={e => setEventType(e.target.value)} aria-label="Event type"><option value="">All event types</option><option value="SCHOOL_ENTRY">School entry</option><option value="SCHOOL_EXIT">School exit</option><option value="CLASSROOM_ENTRY">Classroom entry</option></select>
                {tab === 'discrepancies' ? <select value={discrepancyStatus} onChange={e => setDiscrepancyStatus(e.target.value)} aria-label="Discrepancy status"><option value="">All discrepancy statuses</option><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option></select> : <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Attendance status"><option value="">All attendance statuses</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option><option value="MISMATCH">Mismatch</option></select>}
                <select value={method} onChange={e => setMethod(e.target.value)} aria-label="Identification method"><option value="">All methods</option><option value="NFC">NFC</option><option value="FINGERPRINT">Fingerprint</option><option value="MANUAL">Manual</option></select>
                {tab !== 'discrepancies' && <select value={subject} onChange={e => setSubject(e.target.value as typeof subject)} aria-label="Attendance subject"><option value="all">Students and staff</option><option value="student">Students</option><option value="employee">Staff</option></select>}
              </div>
            </div>
            <AttendanceTable rows={rows} discrepancy={tab === 'discrepancies'} canWrite={canWrite} loading={events.isLoading || discrepancies.isLoading} onCorrect={row => setModal({ correction: row })} />
          </div>
        </>
      )}
      {modal === 'manual' && <Modal title="Record attendance event" eyebrow="Audited manual event" onClose={() => setModal(null)}><ManualForm schoolId={schoolId} onDone={() => { setModal(null); refresh(); }} onCancel={() => setModal(null)} /></Modal>}
      {modal && modal !== 'manual' && <Modal title="Correct attendance" eyebrow="History is preserved" onClose={() => setModal(null)}><CorrectionForm event={modal.correction} onDone={() => { setModal(null); refresh(); }} onCancel={() => setModal(null)} /></Modal>}
    </div>
  );
}

function AttendanceTable({ rows, discrepancy, canWrite, loading, onCorrect }: { rows: any[]; discrepancy: boolean; canWrite: boolean; loading: boolean; onCorrect: (row: any) => void }) {
  if (loading) return <div className="p-8 text-sm text-[hsl(var(--muted-foreground))]">Loading attendance records…</div>;
  if (!rows.length) return <EmptyState icon={ClipboardCheck} title={discrepancy ? 'No discrepancies found' : 'No attendance events found'} description="Try another date or filter. Values are sourced from recorded attendance only." />;
  return <div className="divide-y divide-[hsl(var(--border)/.6)]">{rows.map((row: any, index) => <div key={row.id ?? index} className="grid gap-2 px-5 py-4 md:grid-cols-[1.3fr_1fr_1fr_1fr_auto] md:items-center md:px-6"><div><div className="font-semibold">{row.studentId != null ? `Student ${row.studentName || row.studentId}` : row.employeeId != null ? `Staff ${row.employeeName || row.employeeId}` : 'Attendance record'}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{row.eventType || row.kind || 'Reconciliation discrepancy'}</div></div><div className="text-sm">{time(row.occurredAt || row.detectedAt || row.createdAt)}</div><div><StatusPill value={row.status || 'UNKNOWN'} /></div><div className="text-xs text-[hsl(var(--muted-foreground))]">{row.identificationMethod || row.note || '—'}</div>{!discrepancy && canWrite && <Button variant="outline" onClick={() => onCorrect(row)}>Correct</Button>}</div>)}</div>;
}

function ManualForm({ schoolId, onDone, onCancel }: { schoolId: number; onDone: () => void; onCancel: () => void }) {
  const mutation = useCreateManualAttendance();
  const [subject, setSubject] = useState<'student' | 'employee'>('student');
  const [form, setForm] = useState<{ subjectId: string; eventType: AttendanceEventType; status: AttendanceStatus; occurredAt: string; reason: string; note: string }>({ subjectId: '', eventType: 'SCHOOL_ENTRY', status: 'PRESENT', occurredAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16), reason: '', note: '' });
  const save = (e: FormEvent) => { e.preventDefault(); mutation.mutate({ data: { schoolId, ...(subject === 'student' ? { studentId: Number(form.subjectId) } : { employeeId: Number(form.subjectId) }), eventType: form.eventType, status: form.status, occurredAt: new Date(form.occurredAt).toISOString(), reason: form.reason, note: form.note } }, { onSuccess: onDone }); };
  return <form onSubmit={save} className="space-y-4">
    <Field label="Attendance for"><select value={subject} onChange={e => { setSubject(e.target.value as 'student' | 'employee'); setForm({ ...form, subjectId: '', eventType: 'SCHOOL_ENTRY' }); }}><option value="student">Student</option><option value="employee">Staff member</option></select></Field>
    <Field label={subject === 'student' ? 'Student ID' : 'Employee ID'}><input required type="number" min="1" value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value })} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Event type"><select value={form.eventType} onChange={e => setForm({ ...form, eventType: e.target.value as AttendanceEventType })}><option value="SCHOOL_ENTRY">School entry</option><option value="SCHOOL_EXIT">School exit</option>{subject === 'student' && <option value="CLASSROOM_ENTRY">Classroom entry</option>}</select></Field><Field label="Status"><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as AttendanceStatus })}><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option><option value="LEFT_EARLY">Left early</option></select></Field></div>
    <Field label="Date and time"><input required type="datetime-local" value={form.occurredAt} onChange={e => setForm({ ...form, occurredAt: e.target.value })} /></Field>
    <Field label="Reason (required)"><textarea required minLength={3} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Explain why this event is being recorded manually" /></Field>
    <Field label="Note (optional)"><textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field>
    {mutation.isError && <p className="text-sm text-[hsl(var(--destructive))]">Could not save attendance. Check the ID, date, and reason.</p>}
    <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save event'}</Button></div>
  </form>;
}

function CorrectionForm({ event, onDone, onCancel }: { event: any; onDone: () => void; onCancel: () => void }) {
  const mutation = useCorrectAttendance();
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<AttendanceStatus>(event.status || 'PRESENT');
  const save = (e: FormEvent) => { e.preventDefault(); mutation.mutate({ attendanceId: event.id, data: { status, reason } }, { onSuccess: onDone }); };
  return <form onSubmit={save} className="space-y-4"><p className="text-sm text-[hsl(var(--muted-foreground))]">Original status: <strong>{event.status || 'Unknown'}</strong>. The original event remains in the audit history.</p><Field label="Corrected status"><select value={status} onChange={e => setStatus(e.target.value as AttendanceStatus)}><option value="PRESENT">Present</option><option value="ABSENT">Absent</option><option value="LATE">Late</option><option value="EXCUSED">Excused</option></select></Field><Field label="Reason (required)"><textarea required minLength={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>{mutation.isError && <p className="text-sm text-[hsl(var(--destructive))]">Could not apply correction. The original event was not changed.</p>}<div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Apply correction'}</Button></div></form>;
}