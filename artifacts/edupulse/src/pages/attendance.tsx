import { useState, type FormEvent } from 'react';
import { Activity, AlertTriangle, ClipboardCheck, Clock3, Plus, RefreshCw } from 'lucide-react';
import {
  useGetSchoolAttendanceToday, useListSchoolAttendanceEvents, useListAttendanceDiscrepancies,
  useCreateManualAttendance, useCorrectAttendance, useResolveAttendanceDiscrepancy,
  useGetClassAttendance, getGetClassAttendanceQueryKey,
  getGetSchoolAttendanceTodayQueryKey, getListSchoolAttendanceEventsQueryKey,
  getListAttendanceDiscrepanciesQueryKey,
  useGetAuthorizedContext,
} from '@workspace/api-client-react';
import type { AttendanceEventType, AttendanceStatus } from '@workspace/api-client-react';
import {
  Button, EmptyState, ErrorState, Field, Metric, Modal, PageHeading, SkeletonPage,
  StatusPill, TenantPicker, useTenant, cx, time,
} from '@/components/shared';
import { SchoolDocumentHeader, SchoolDocumentPrintButton, useSchoolDocumentBranding } from '@/components/school-document';

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
  const [section, setSection] = useState('');
  const [discrepancyStatus, setDiscrepancyStatus] = useState('');
  const [modal, setModal] = useState<'manual' | { correction: any } | { discrepancy: any } | null>(null);
  const contextQuery = useGetAuthorizedContext();
  const isPlatformOwner = contextQuery.data?.isPlatformOwner === true;
  const tenantRoles = contextQuery.data?.roles?.filter(role => role.schoolId === schoolId && role.status === 'ACTIVE').map(role => role.role) ?? [];
  const isSchoolAdmin = tenantRoles.includes('SCHOOL_ADMIN');
  const isTeacherView = !isPlatformOwner && tenantRoles.includes('TEACHER');
  const canWrite = !isPlatformOwner && (isSchoolAdmin || tenantRoles.includes('TEACHER') || tenantRoles.includes('STAFF'));
  const canCorrect = !isPlatformOwner && isSchoolAdmin;

  const today = useGetSchoolAttendanceToday(
    { schoolId, date },
    { query: { enabled: !!schoolId && !isTeacherView, queryKey: getGetSchoolAttendanceTodayQueryKey({ schoolId, date }) } },
  );
  const eventFrom = tab === 'events' ? `${date}T00:00:00.000Z` : `${fromDate}T00:00:00.000Z`;
  const eventTo = tab === 'events' ? `${date}T23:59:59.999Z` : `${toDate}T23:59:59.999Z`;
  const events = useListSchoolAttendanceEvents(
    { schoolId, from: eventFrom, to: eventTo, eventType: eventType || undefined, status: status || undefined, identificationMethod: method || undefined, section: section || undefined } as any,
    { query: { enabled: !!schoolId && !isTeacherView && tab !== 'discrepancies', queryKey: getListSchoolAttendanceEventsQueryKey({ schoolId, from: eventFrom, to: eventTo, eventType: eventType || undefined, status: status || undefined, identificationMethod: method || undefined, section: section || undefined } as any) } },
  );
  const discrepancies = useListAttendanceDiscrepancies(
    { schoolId, status: discrepancyStatus || undefined, from: fromDate, to: toDate } as any,
    { query: { enabled: !!schoolId && !isTeacherView && tab === 'discrepancies', queryKey: getListAttendanceDiscrepanciesQueryKey({ schoolId, status: discrepancyStatus || undefined, from: fromDate, to: toDate } as any) } },
  );

  const refresh = () => {
    void today.refetch();
    void events.refetch();
    void discrepancies.refetch();
  };
  const summary: any = today.data;
  const rows: any[] = tab === 'discrepancies' ? ((discrepancies.data as any[]) ?? []) : ((events.data as any[]) ?? []).filter(row => subject === 'all' || (subject === 'student' ? row.studentId != null : row.employeeId != null));

  if (!schoolId) return <div className="fade-up"><PageHeading eyebrow="Operations / Attendance" title="Attendance, with context." description="Select a school to inspect attendance events and reconciliation." action={<TenantPicker />} /><EmptyState icon={ClipboardCheck} title="Select a school context" description="Platform owners can choose any active school; school users see their authorized school." /></div>;
  if (isTeacherView) return <TeacherClassAttendance schoolId={schoolId} />;
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
                {tab === 'events' ? <label className="flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">School day <input type="date" value={date} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDate(e.target.value); }} aria-label="School day" /></label> : <><label className="flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">From <input type="date" value={fromDate} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setFromDate(e.target.value); }} aria-label="History start date" /></label><label className="flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">To <input type="date" value={toDate} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setToDate(e.target.value); }} aria-label="History end date" /></label></>}
                {tab !== 'discrepancies' && <select value={eventType} onChange={e => setEventType(e.target.value)} aria-label="Event type"><option value="">All event types</option><option value="SCHOOL_ENTRY">School entry</option><option value="SCHOOL_EXIT">School exit</option><option value="CLASSROOM_ENTRY">Class entry</option></select>}
                {tab === 'discrepancies' ? <select value={discrepancyStatus} onChange={e => setDiscrepancyStatus(e.target.value)} aria-label="Discrepancy status"><option value="">All discrepancy statuses</option><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option></select> : <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Attendance status"><option value="">All attendance statuses</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="ABSENT">Absent</option><option value="MISMATCH">Mismatch</option></select>}
                {tab !== 'discrepancies' && <select value={method} onChange={e => setMethod(e.target.value)} aria-label="Identification method"><option value="">All methods</option><option value="NFC">NFC</option><option value="FINGERPRINT">Fingerprint</option><option value="MANUAL">Manual</option></select>}
                {tab !== 'discrepancies' && <select value={subject} onChange={e => setSubject(e.target.value as typeof subject)} aria-label="Attendance subject"><option value="all">Students and staff</option><option value="student">Students</option><option value="employee">Staff</option></select>}
                {tab !== 'discrepancies' && <input type="text" placeholder="Section (e.g. A)" className="max-w-[120px] rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]" value={section} onChange={e => setSection(e.target.value)} aria-label="Section filter" />}
                {tab !== 'discrepancies' && <AttendancePrintDocument
                  schoolId={schoolId}
                  rows={rows}
                  fromDate={tab === 'events' ? date : fromDate}
                  toDate={tab === 'events' ? date : toDate}
                  filters={{ eventType, status, method, subject, section }}
                  disabled={events.isLoading || events.isError || rows.length === 0}
                  unavailableMessage={events.isError ? 'Filtered attendance could not be loaded. Retry before printing.' : events.isLoading ? 'Loading filtered attendance records.' : 'There are no recorded events in this filter.'}
                />}
              </div>
            </div>
            <AttendanceTable rows={rows} discrepancy={tab === 'discrepancies'} canCorrect={canCorrect} loading={events.isLoading || discrepancies.isLoading} onCorrect={row => setModal({ correction: row })} onResolve={row => setModal({ discrepancy: row })} />
          </div>
        </>
      )}
      {canWrite && modal === 'manual' && <Modal title="Record attendance event" eyebrow="Audited manual event" onClose={() => setModal(null)}><ManualForm schoolId={schoolId} onDone={() => { setModal(null); refresh(); }} onCancel={() => setModal(null)} /></Modal>}
      {canCorrect && modal && typeof modal === 'object' && 'correction' in modal && <Modal title="Correct attendance" eyebrow="History is preserved" onClose={() => setModal(null)}><CorrectionForm event={modal.correction} onDone={() => { setModal(null); refresh(); }} onCancel={() => setModal(null)} /></Modal>}
      {modal && typeof modal === 'object' && 'discrepancy' in modal && <Modal title="Review Discrepancy" eyebrow="Reconciliation" onClose={() => setModal(null)}><ResolveDiscrepancyForm discrepancy={modal.discrepancy} schoolId={schoolId} onDone={() => { setModal(null); refresh(); }} onCancel={() => setModal(null)} canResolve={canCorrect} /></Modal>}
    </div>
  );
}

function TeacherClassAttendance({ schoolId }: { schoolId: number }) {
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const selectedClassId = Number(classId);
  const validClassId = Number.isInteger(selectedClassId) && selectedClassId > 0;
  const report = useGetClassAttendance(selectedClassId, { schoolId, date }, {
    query: { enabled: validClassId && !!schoolId, queryKey: getGetClassAttendanceQueryKey(selectedClassId, { schoolId, date }) },
  });
  return <div className="fade-up">
    <PageHeading eyebrow="Operations / Attendance" title="Class attendance" description="Only your assigned classes are available. School-wide attendance is restricted." action={<TenantPicker />} />
    <div className="panel mb-5 flex flex-wrap gap-4 p-5">
      <Field label="Assigned class ID"><input type="number" min="1" value={classId} onChange={e => setClassId(e.target.value)} /></Field>
      <Field label="School day"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
    </div>
    {!validClassId ? <EmptyState icon={ClipboardCheck} title="Choose an assigned class" description="Enter an assigned class ID to view its attendance for the selected day." /> :
      report.isError ? <div role="alert" className="panel p-5">This class is unavailable or you are not assigned to it.</div> :
      <div className="space-y-4">
        {!!report.data?.length && <AttendancePrintDocument schoolId={schoolId} rows={report.data as any[]} fromDate={date} toDate={date} filters={{ classId: selectedClassId }} disabled={report.isLoading || report.isError} unavailableMessage={report.isError ? 'Class attendance could not be loaded.' : 'Loading assigned class attendance.'} />}
        <AttendanceTable rows={(report.data as any[]) ?? []} discrepancy={false} canCorrect={false} loading={report.isLoading} onCorrect={() => {}} onResolve={() => {}} />
      </div>}
  </div>;
}

function AttendancePrintDocument({
  schoolId,
  rows,
  fromDate,
  toDate,
  filters,
  disabled,
  unavailableMessage,
}: {
  schoolId: number;
  rows: any[];
  fromDate: string;
  toDate: string;
  filters: Record<string, string | number>;
  disabled: boolean;
  unavailableMessage: string;
}) {
  const branding = useSchoolDocumentBranding(schoolId);
  const school = branding.data;
  const activeFilters = Object.entries(filters)
    .filter(([, value]) => value !== '' && value !== 'all')
    .map(([key, value]) => `${key}: ${value}`);
  return <SchoolDocumentPrintButton
    label="Print filtered report"
    testId={`button-print-attendance-${schoolId}`}
    disabled={disabled || !school || branding.isLoading || branding.isError}
    unavailableMessage={branding.isError ? 'School branding could not be loaded for this attendance report.' : unavailableMessage}
  >
    <article className="school-document-page">
      <SchoolDocumentHeader branding={school ?? {}} />
      <h2 className="school-document-title">Attendance report</h2>
      <dl className="school-document-grid">
        <div className="school-document-field"><dt>Period</dt><dd>{fromDate}{toDate !== fromDate ? ` – ${toDate}` : ''}</dd></div>
        <div className="school-document-field"><dt>Matching recorded rows</dt><dd>{rows.length}</dd></div>
        {activeFilters.map(filter => <div className="school-document-field" key={filter}><dt>Applied filter</dt><dd>{filter}</dd></div>)}
      </dl>
      <table className="school-document-table">
        <thead><tr><th>Student / staff</th><th>Event time</th><th>Event</th><th>Status</th><th>Identification method</th><th>Section</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id ?? index}>
          <td>{row.studentId != null ? `${row.studentName || `Student #${row.studentId}`}` : row.employeeId != null ? `${row.employeeName || `Staff #${row.employeeId}`}` : 'Attendance record'}</td>
          <td>{row.occurredAt ? new Date(row.occurredAt).toLocaleString('en-NG') : ''}</td>
          <td>{row.eventType ?? row.kind ?? ''}</td>
          <td>{row.status ?? ''}</td>
          <td>{row.identificationMethod ?? ''}</td>
          <td>{row.section ?? ''}</td>
        </tr>)}</tbody>
      </table>
    </article>
  </SchoolDocumentPrintButton>;
}

function AttendanceTable({ rows, discrepancy, canCorrect, loading, onCorrect, onResolve }: { rows: any[]; discrepancy: boolean; canCorrect: boolean; loading: boolean; onCorrect: (row: any) => void; onResolve: (row: any) => void }) {
  if (loading) return <div className="p-8 text-sm text-[hsl(var(--muted-foreground))]">Loading attendance records…</div>;
  if (!rows.length) return <EmptyState icon={ClipboardCheck} title={discrepancy ? 'No discrepancies found' : 'No attendance events found'} description="Try another date or filter. Values are sourced from recorded attendance only." />;
  return <div className="divide-y divide-[hsl(var(--border)/.6)]">{rows.map((row: any, index) => <div key={row.id ?? index} className="grid gap-2 px-5 py-4 md:grid-cols-[1.3fr_1fr_1fr_1fr_auto] md:items-center md:px-6"><div><div className="font-semibold">{row.studentId != null ? `Student ${row.studentName || row.studentId}` : row.employeeId != null ? `Staff ${row.employeeName || row.employeeId}` : 'Attendance record'}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{row.eventType || row.kind || 'Reconciliation discrepancy'}</div></div><div className="text-sm">{time(row.occurredAt || row.detectedAt || row.createdAt)}</div><div><StatusPill value={row.status || 'UNKNOWN'} /></div><div className="text-xs text-[hsl(var(--muted-foreground))]">{row.identificationMethod || row.note || '—'}</div><div className="flex justify-end gap-2">{!discrepancy && canCorrect && <Button variant="outline" onClick={() => onCorrect(row)}>Correct</Button>}{discrepancy && canCorrect && <Button variant="outline" onClick={() => onResolve(row)}>Review</Button>}</div></div>)}</div>;
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

function ResolveDiscrepancyForm({ discrepancy, schoolId, onDone, onCancel, canResolve }: { discrepancy: any; schoolId: number; onDone: () => void; onCancel: () => void; canResolve: boolean }) {
  const mutation = useResolveAttendanceDiscrepancy();
  const [status, setStatus] = useState<'RESOLVED' | 'DISMISSED'>('RESOLVED');
  const [reason, setReason] = useState('');
  const save = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate({ discrepancyId: discrepancy.id, data: { schoolId, status, reason } }, { onSuccess: onDone });
  };
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[hsl(var(--border))] p-4 space-y-2 text-sm bg-[hsl(var(--muted)/.3)]">
        <div><strong>School:</strong> #{discrepancy.schoolId}</div>
        <div><strong>Student:</strong> {discrepancy.studentName || discrepancy.studentId || 'Unknown'}</div>
        <div><strong>Discrepancy:</strong> {discrepancy.kind}</div>
        <div><strong>Detected At:</strong> {time(discrepancy.detectedAt)}</div>
        <div><strong>Status:</strong> {discrepancy.status}</div>
        <div><strong>Related Event:</strong> {discrepancy.attendanceEventId ? `Event #${discrepancy.attendanceEventId} · ${discrepancy.relatedEvent?.eventType || 'Attendance'} · ${discrepancy.relatedEvent?.status || '—'} · ${time(discrepancy.relatedEvent?.occurredAt)}` : 'None'}</div>
        {discrepancy.relatedEvent && <div><strong>Class / Section at event:</strong> {discrepancy.relatedEvent.classId ? `Class #${discrepancy.relatedEvent.classId}` : 'Not recorded'} / {discrepancy.relatedEvent.section || 'Not recorded'}</div>}
        {discrepancy.resolvedBy && (
          <div className="mt-2 pt-2 border-t border-[hsl(var(--border))]">
            <div><strong>Resolved By:</strong> {discrepancy.resolver?.name || discrepancy.resolvedBy}</div>
            <div><strong>Resolved At:</strong> {time(discrepancy.resolvedAt)}</div>
            <div><strong>Resolution Reason:</strong> {discrepancy.resolutionReason || '—'}</div>
          </div>
        )}
      </div>
      {discrepancy.auditHistory?.length > 0 && (
        <div className="text-xs text-[hsl(var(--muted-foreground))]">
          <strong>Audit History:</strong>
          <ul className="mt-1 space-y-1 list-disc pl-4">
            {discrepancy.auditHistory.map((audit: any, i: number) => (
              <li key={i}>{time(audit.createdAt)} - {audit.action} by user #{audit.actorUserId}</li>
            ))}
          </ul>
        </div>
      )}
      {canResolve && discrepancy.status === 'OPEN' && (
        <form onSubmit={save} className="space-y-4 pt-4 border-t border-[hsl(var(--border))]">
          <Field label="Resolution Action">
            <select value={status} onChange={e => setStatus(e.target.value as 'RESOLVED' | 'DISMISSED')}>
              <option value="RESOLVED">Resolve (Fix applied)</option>
              <option value="DISMISSED">Dismiss (No action needed)</option>
            </select>
          </Field>
          <Field label="Reason (required)">
            <textarea required minLength={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain the resolution or dismissal" />
          </Field>
          {mutation.isError && <p className="text-sm text-[hsl(var(--destructive))]">{(mutation.error as any)?.response?.data?.error || mutation.error?.message || 'Could not resolve discrepancy. Please check authorization and try again.'}</p>}
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={onCancel} type="button">Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Submit Resolution'}</Button>
          </div>
        </form>
      )}
      {(!canResolve || discrepancy.status !== 'OPEN') && (
        <div className="flex justify-end pt-4 border-t border-[hsl(var(--border))]">
          <Button variant="outline" onClick={onCancel}>Close</Button>
        </div>
      )}
    </div>
  );
}