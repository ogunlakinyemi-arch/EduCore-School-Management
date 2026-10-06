import { useEffect, useState } from 'react';
import { Nfc, ShieldOff, CheckCircle2 } from 'lucide-react';
import {
  useGetMyPartnerNfcSchools, useGetMyPartnerNfcStudents, useGetMyPartnerNfcCards, useAssignMyPartnerNfcCard,
  getGetMyPartnerNfcSchoolsQueryKey, getGetMyPartnerNfcStudentsQueryKey, getGetMyPartnerNfcCardsQueryKey,
  type PartnerNfcAssignment,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, StatusPill } from '@/components/shared';
import { canAssign, usePartnerNfcAccess } from './nfc-access';

const Note = ({ children, alert }: { children: React.ReactNode; alert?: boolean }) => (
  <p role={alert ? 'alert' : 'status'} className={`p-4 text-sm ${alert ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{children}</p>
);
const Skel = () => <div className="space-y-2 p-4" aria-busy="true"><div className="skeleton h-10 rounded-xl" /><div className="skeleton h-10 rounded-xl" /></div>;

export default function PartnerNfcActivation() {
  const { query: access, allowed } = usePartnerNfcAccess();
  const qc = useQueryClient();
  const partnerId = access.data?.partnerId ?? 0;
  const [schoolId, setSchoolId] = useState<number | null>(null);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [cardSearch, setCardSearch] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [result, setResult] = useState<PartnerNfcAssignment | null>(null);
  const [error, setError] = useState('');
  const assign = useAssignMyPartnerNfcCard();

  const schools = useGetMyPartnerNfcSchools({ query: { queryKey: [...getGetMyPartnerNfcSchoolsQueryKey(), 'activation', partnerId], enabled: allowed, gcTime: 0 } });
  const school = allowed ? schools.data?.find(s => s.schoolId === schoolId) : undefined;
  const eligible = !!school?.eligible && !schools.isError;
  const sp = { search: search.trim() || undefined, limit: 25 };
  const students = useGetMyPartnerNfcStudents(schoolId ?? 0, sp, { query: { queryKey: [...getGetMyPartnerNfcStudentsQueryKey(schoolId ?? 0, sp), partnerId], enabled: allowed && eligible && schoolId != null, gcTime: 0 } });
  const cp = { search: cardSearch.trim() || undefined, limit: 25 };
  const cards = useGetMyPartnerNfcCards(schoolId ?? 0, cp, { query: { queryKey: [...getGetMyPartnerNfcCardsQueryKey(schoolId ?? 0, cp), partnerId], enabled: allowed && eligible && schoolId != null, gcTime: 0 } });

  const reset = () => { setStudentId(null); setCardNumber(''); setResult(null); setError(''); setSearch(''); setCardSearch(''); };
  useEffect(() => { reset(); }, [schoolId]);
  useEffect(() => { if (!allowed) { setSchoolId(null); reset(); } }, [allowed]);
  // Selection must still exist in the latest successful list
  useEffect(() => {
    if (studentId != null && students.data && !students.data.some(s => s.studentId === studentId)) setStudentId(null);
  }, [students.data, studentId]);

  const header = (
    <div className="mb-7"><div className="eyebrow">Partner NFC</div>
      <h1 className="display-font mt-2 text-3xl font-bold">NFC Card Activation</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Assign an available school card to an eligible student. Cards are assigned locked.</p></div>
  );
  const wrap = (c: React.ReactNode) => <div className="mx-auto max-w-5xl p-5 md:p-8 animate-in fade-in duration-500">{header}{c}</div>;

  if (access.isLoading) return wrap(<div className="panel"><Skel /></div>);
  if (access.isError) return wrap(<div className="panel p-8 text-center" role="alert" data-testid="nfc-access-error">
    <ShieldOff className="mx-auto mb-3" /><h2 className="display-font text-xl font-bold">Access could not be confirmed</h2>
    <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Activation is unavailable until access is verified.</p>
    <div className="mt-5"><Button variant="outline" onClick={() => void access.refetch()}>Retry</Button></div></div>);
  if (!allowed) return wrap(<div className="panel p-8 text-center" role="status" data-testid="nfc-access-revoked">
    <ShieldOff className="mx-auto mb-3" /><h2 className="display-font text-xl font-bold">NFC activation is not enabled</h2>
    <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Your access was not granted or has been revoked. Contact your partner administrator.</p></div>);

  const ok = canAssign({ allowed, schoolsError: schools.isError, studentsError: students.isError, cardsError: cards.isError, schoolEligible: eligible, studentId, cardNumber, pending: assign.isPending });
  const submit = () => {
    if (!ok || schoolId == null || studentId == null) return;
    setError(''); setResult(null);
    assign.mutate({ schoolId, data: { studentId, cardNumber } }, {
      onSuccess: r => { setResult(r); setStudentId(null); setCardNumber('');
        void qc.invalidateQueries({ queryKey: getGetMyPartnerNfcCardsQueryKey(schoolId) });
        void qc.invalidateQueries({ queryKey: getGetMyPartnerNfcStudentsQueryKey(schoolId) }); },
      onError: (e: any) => { setError(e?.message ?? 'Assignment failed.'); void access.refetch(); },
    });
  };

  return wrap(<div className="space-y-6">
    {result && <div className="panel border-l-4 border-l-[hsl(157_37%_43%)] p-5" role="status" data-testid="nfc-assignment-result">
      <div className="flex items-center gap-2 font-bold"><CheckCircle2 size={18} /> {result.message}</div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="eyebrow">School</dt><dd>{result.schoolName}</dd></div>
        <div><dt className="eyebrow">Student</dt><dd>{result.studentName} ({result.admissionNo})</dd></div>
        <div><dt className="eyebrow">Class</dt><dd>{result.className} {result.section}</dd></div>
        <div><dt className="eyebrow">Card</dt><dd className="font-mono">{result.cardNumber} <StatusPill value={result.status} /></dd></div>
      </dl></div>}
    <section className="panel overflow-hidden" aria-label="Referred schools">
      <div className="border-b border-[hsl(var(--border))] p-5"><h2 className="display-font text-xl font-bold">1. Choose a school</h2></div>
      {schools.isLoading ? <Skel /> : schools.isError ? <div><Note alert>Schools could not be loaded.</Note><div className="px-4 pb-4"><Button variant="outline" onClick={() => void schools.refetch()}>Retry</Button></div></div>
        : !schools.data?.length ? <Note>No referred schools yet.</Note>
        : <ul className="divide-y divide-[hsl(var(--border)/.6)]">{schools.data.map(s => (
          <li key={s.schoolId} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div><div className="font-bold">{s.schoolName}</div><div className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{s.schoolCode} · {s.activeDeviceCount} active device(s)</div>
              {!s.eligible && <div className="mt-1 text-xs text-[hsl(var(--destructive))]" data-testid={`text-school-reason-${s.schoolId}`}>{s.unavailableReason ?? 'Unavailable'}</div>}</div>
            <div className="flex items-center gap-2"><StatusPill value={s.status} />
              <Button variant={schoolId === s.schoolId ? 'primary' : 'outline'} disabled={!s.eligible} onClick={() => setSchoolId(s.schoolId)} testId={`button-select-school-${s.schoolId}`}>
                {schoolId === s.schoolId ? 'Selected' : 'Select'}</Button></div>
          </li>))}</ul>}
    </section>
    {eligible && <div className="grid gap-6 lg:grid-cols-2">
      <section className="panel overflow-hidden" aria-label="Eligible students">
        <div className="border-b border-[hsl(var(--border))] p-5"><h2 className="display-font text-xl font-bold">2. Choose a student</h2>
          <input className="mt-3" placeholder="Search name or admission number" aria-label="Search students" value={search} onChange={e => setSearch(e.target.value)} /></div>
        {students.isLoading ? <Skel /> : students.isError ? <Note alert>Students could not be loaded; assignment is disabled.</Note>
          : !students.data?.length ? <Note>No eligible students match.</Note>
          : <ul className="max-h-80 divide-y divide-[hsl(var(--border)/.6)] overflow-auto">{students.data.map(s => (
            <li key={s.studentId}><button type="button" aria-pressed={studentId === s.studentId} onClick={() => setStudentId(s.studentId)} data-testid={`button-student-${s.studentId}`}
              className={`w-full p-4 text-left text-sm hover:bg-[hsl(var(--muted)/.4)] ${studentId === s.studentId ? 'bg-[hsl(var(--primary)/.08)]' : ''}`}>
              <div className="font-bold">{s.firstName} {s.middleName ?? ''} {s.lastName}</div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{s.admissionNo} · {s.className} {s.section}</div></button></li>))}</ul>}
      </section>
      <section className="panel overflow-hidden" aria-label="Card inventory">
        <div className="border-b border-[hsl(var(--border))] p-5"><h2 className="display-font text-xl font-bold">3. Choose a card</h2>
          <input className="mt-3" placeholder="Search inventory" aria-label="Search cards" value={cardSearch} onChange={e => setCardSearch(e.target.value)} /></div>
        {cards.isLoading ? <Skel /> : cards.isError ? <Note alert>Card inventory could not be loaded; assignment is disabled.</Note>
          : !cards.data?.length ? <Note>No available cards in this school inventory. You can still enter a card number below.</Note>
          : <ul className="max-h-48 divide-y divide-[hsl(var(--border)/.6)] overflow-auto">{cards.data.map(c => (
            <li key={c.cardId}><button type="button" aria-pressed={cardNumber === c.cardNumber} onClick={() => setCardNumber(c.cardNumber)} data-testid={`button-card-${c.cardId}`}
              className={`flex w-full items-center justify-between p-3 text-left font-mono text-sm hover:bg-[hsl(var(--muted)/.4)] ${cardNumber === c.cardNumber ? 'bg-[hsl(var(--primary)/.08)]' : ''}`}>{c.cardNumber}<StatusPill value={c.status} /></button></li>))}</ul>}
        <div className="border-t border-[hsl(var(--border))] p-4"><Field label="Card number">
          <input value={cardNumber} onChange={e => setCardNumber(e.target.value.trim())} maxLength={100} data-testid="input-card-number" /></Field></div>
      </section>
    </div>}
    {eligible && <div className="flex flex-col items-end gap-2">
      {error && <p role="alert" className="text-sm text-[hsl(var(--destructive))]" data-testid="text-assign-error">{error}</p>}
      <Button disabled={!ok} onClick={submit} testId="button-assign-card"><Nfc size={16} />{assign.isPending ? 'Assigning...' : 'Assign card (locked)'}</Button></div>}
  </div>);
}
