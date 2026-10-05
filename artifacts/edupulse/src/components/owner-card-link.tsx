import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  useListCards, useListEmployees, useListEmployeeNfcCards, useListOwnerSchoolDirectory, useListStudents,
  useRegisterCard, useAssignEmployeeNfcCard, useReassignCard, useListActivationDevices, getListCardsQueryKey,
} from '@workspace/api-client-react';
import { Button, Field, Info, StatusPill } from '@/components/shared';
import { PrintableNfcCardDownload } from '@/components/printable-nfc-card-download';
import {
  buildLinkRequest, scopedCardsParams, validSchoolId, employeeMatchesType, findCurrentCard, linkErrorMessage, personDetails, personName, accountStatus,
  type LinkPersonType, type Person,
} from '@/lib-card-link';

export function OwnerCardLink({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient();
  const [schoolId, setSchoolId] = useState(0);
  const [type, setType] = useState<LinkPersonType>('STUDENT');
  const [personId, setPersonId] = useState(0);
  const [search, setSearch] = useState('');
  const [uid, setUid] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [printedAssignment, setPrintedAssignment] = useState<{ cardId: number; status: string } | null>(null);

  const resetPerson = () => { setPersonId(0); setUid(''); setMsg(''); setErr(''); setPrintedAssignment(null); };
  const changeSchool = (id: number) => { setSchoolId(validSchoolId(id)); setSearch(''); resetPerson(); };
  const changeType = (t: LinkPersonType) => { setType(t); setSearch(''); resetPerson(); };

  const schools = useListOwnerSchoolDirectory({ status: 'all' });
  const isStudent = type === 'STUDENT';
  const devices = useListActivationDevices(schoolId, {query:{
    enabled:schoolId>0 && isStudent,queryKey:['owner-link-nfc-devices',schoolId],
    staleTime:0,refetchOnMount:'always',refetchOnWindowFocus:true,refetchInterval:15000,
  }});
  const devicesReady = devices.isSuccess && !devices.isFetching && (devices.data?.length ?? 0)>0;
  const students = useListStudents({ schoolId, search: search || undefined }, { query: { enabled: !!schoolId && isStudent, queryKey: ['owner-link-students', schoolId, search] } });
  const employees = useListEmployees({ schoolId, search: search || undefined }, { query: { enabled: !!schoolId && !isStudent, queryKey: ['owner-link-employees', schoolId, search] } });
  const empCards = useListEmployeeNfcCards(schoolId, { limit: 200 }, { query: { enabled: !!schoolId && !isStudent, queryKey: ['owner-link-emp-cards', schoolId] } });

  const cardsParams = scopedCardsParams(schoolId);
  const studentCardsQuery = useListCards(cardsParams, { query: { enabled: !!schoolId && isStudent, queryKey: getListCardsQueryKey(cardsParams) } });
  const active = isStudent ? students : employees;
  const people: Person[] = ((active.data as Person[]) ?? []).filter(p => isStudent || employeeMatchesType(p, type));
  const person = people.find(p => p.id === personId);
  const card = findCurrentCard(type, person, (studentCardsQuery.data as Person[] | undefined) ?? [], (empCards.data as Person[]) ?? []);
  const details = person ? personDetails(person, type) : null;

  const reg = useRegisterCard();
  const assign = useAssignEmployeeNfcCard();
  const reassign = useReassignCard();
  const pending = reg.isPending || assign.isPending || reassign.isPending;
  const req = person ? buildLinkRequest(type, schoolId, person.id, uid) : null;

  const done = (response?: any) => {
    setMsg(`Card ${req?.data.uid} linked to ${person ? personName(person) : 'person'}.`);
    setUid('');
    const returnedCardId = req?.kind === 'student' ? response?.id : response?.cardId;
    if (type === 'STUDENT' || type === 'TEACHER') {
      if (Number.isInteger(returnedCardId) && returnedCardId > 0) {
        setPrintedAssignment({ cardId: returnedCardId, status: String(response?.status ?? 'LOCKED') });
      } else {
        setPrintedAssignment(null);
        setErr('The card was linked, but the server did not return its card reference for printing. Refresh the card list to reprint it.');
      }
    }
    qc.invalidateQueries({ queryKey: getListCardsQueryKey() });
    qc.invalidateQueries({ queryKey: ['owner-link-emp-cards'] });
    onDone?.();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setMsg(''); setErr('');
    if (!req) return;
    if (req.kind==='student' && !devicesReady) {
      setErr("This school has no active NFC device linked. Link an NFC device to this school before assigning NFC cards.");
      return;
    }
    const opts = { onSuccess: done, onError: (x: unknown) => setErr(linkErrorMessage(x)) };
    if (req.kind === 'student') {
      const available=studentCardsQuery.data?.find(c=>c.uid.toUpperCase()===req.data.uid.toUpperCase() &&
        c.studentId==null && !c.employeeId && c.status.toLowerCase()==='unassigned');
      if(available) reassign.mutate({cardId:available.id,data:{studentId:person!.id}},opts);
      else reg.mutate({ params: req.params, data: req.data }, opts);
    }
    else assign.mutate({ schoolId: req.schoolId, data: req.data }, opts);
  };

  return (
    <form onSubmit={submit} className="panel mb-6 space-y-5 p-5 md:p-6" aria-label="Link card to existing person" data-testid="owner-card-link">
      <div><div className="eyebrow">Platform owner</div><h2 className="display-font text-xl font-bold">Link card to an existing person</h2></div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="1. School">
          <select value={schoolId} onChange={e => changeSchool(Number(e.target.value))} data-testid="select-link-school">
            <option value={0}>Select a school</option>
            {schools.data?.schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="2. Person type">
          <select value={type} onChange={e => changeType(e.target.value as LinkPersonType)} data-testid="select-link-type">
            <option value="STUDENT">Student</option><option value="TEACHER">Teacher</option><option value="STAFF">Staff</option>
          </select>
        </Field>
        <Field label="Search name or number">
          <input value={search} disabled={!schoolId} onChange={e => { setSearch(e.target.value); resetPerson(); }} data-testid="input-link-search" />
        </Field>
      </div>
      {schoolId>0 && isStudent && <div data-testid="linked-nfc-devices">
        <Field label="Linked NFC Devices (automatically loaded)">
          {devices.isLoading || devices.isFetching ? <p role="status">Loading linked NFC devices…</p> :
            devices.isError ? <p role="alert">{linkErrorMessage(devices.error)} <button type="button" onClick={()=>devices.refetch()}>Retry devices</button></p> :
            devices.data?.length ? <div className="space-y-2">{devices.data.map(device=>
              <input key={device.id} readOnly value={device.serialNumber} aria-label={`Linked NFC device ${device.serialNumber}`} />
            )}</div> : <div role="status" className="space-y-2">
              <p>This school has no active NFC device linked. Link an NFC device to this school before assigning NFC cards.</p>
              <Link href="/devices" className="underline font-semibold">Link NFC Device</Link>
            </div>}
        </Field>
        {!!devices.data?.length && <p className="text-xs">The card belongs to the school and works on all its active linked NFC devices. No separate assignment per device is needed.</p>}
      </div>}
      {schoolId > 0 && (active.isError
        ? <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{linkErrorMessage(active.error)} <button type="button" className="underline" onClick={() => active.refetch()}>Retry</button></p>
        : <Field label="3. Existing person">
            <select value={personId} onChange={e => { setPersonId(Number(e.target.value)); setMsg(''); setErr(''); setPrintedAssignment(null); }} data-testid="select-link-person">
              <option value={0}>{active.isLoading ? 'Loading…' : people.length ? 'Select a person' : 'No matching people'}</option>
              {people.map(p => <option key={p.id} value={p.id}>{personName(p)} · {personDetails(p, type).identifier}</option>)}
            </select>
          </Field>)}
      {person && details && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="link-person-summary">
          <Info label="Name" value={personName(person)} />
          <Info label={isStudent ? 'Admission no. / class' : 'Employee no. / department'} value={`${details.identifier} / ${details.group}`} />
          <Info label="Account status" value={accountStatus(person) === 'Not available' ? 'Not available' : <StatusPill value={accountStatus(person)} />} />
          <Info label="NFC status" value={studentCardsQuery.isError && isStudent ? 'Not available' : card ? <StatusPill value={card.status} /> : 'No card'} />
          <Info label="Current card" value={studentCardsQuery.isError && isStudent ? 'Not available' : card?.uid ? <span className="font-mono">{card.uid}</span> : 'None'} />
        </div>
      )}
      {person && (
        <>
          <Field label="4. Card UID (type or scan)">
            <input required minLength={4} autoComplete="off" value={uid} onChange={e => setUid(e.target.value.toUpperCase())} className="font-mono uppercase" data-testid="input-link-uid" />
          </Field>
          {!isStudent && <p className="text-xs text-[hsl(var(--muted-foreground))]">Card status, history and replacement are managed on <Link href="/employee-nfc" className="underline">Employee NFC</Link>.</p>}
          {card && <p className="text-xs text-[hsl(var(--muted-foreground))]">This person already has a card; the server decides whether linking another is allowed.</p>}
        </>
      )}
      {msg && <p role="status" className="text-sm font-semibold text-emerald-600" data-testid="link-success">{msg}</p>}
      {err && <p role="alert" className="text-sm font-semibold text-[hsl(var(--destructive))]" data-testid="link-error">{err}</p>}
      {printedAssignment && (
        <div className="space-y-1" data-testid="assigned-card-print">
          <PrintableNfcCardDownload
            cardId={printedAssignment.cardId}
            schoolId={schoolId}
            ownerAuthorized
            cardType={type}
            cardStatus={printedAssignment.status}
          />
        </div>
      )}
      <div className="flex justify-end"><Button type="submit" disabled={!req || pending || (isStudent && !devicesReady)} testId="button-link-card">{pending ? 'Linking…' : 'Link card'}</Button></div>
    </form>
  );
}
