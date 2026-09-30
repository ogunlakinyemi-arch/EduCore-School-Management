import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, FileClock, GraduationCap, Printer, Radio, ShieldCheck } from 'lucide-react';
import { Button, EmptyState, Field, PageHeading, SkeletonPage } from '@/components/shared';

type Id = number | string;
type School = { id: Id; name: string };
type Device = { id: Id; name: string; serialNumber: string; deviceType: string };
type Student = {
  id: Id;
  firstName: string;
  lastName: string;
  admissionNo: string;
  className: string;
  section: string;
};
type EidRecord = Record<string, any>;

const activationBase = '/api/activation';
const schoolsKey = ['activation', 'schools'];

function unwrapArray<T>(payload: unknown, keys: string[], resource: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  throw new Error(`The activation service returned an invalid ${resource} response.`);
}

function validId(value: unknown): value is Id {
  return typeof value === 'number' || (typeof value === 'string' && value.length > 0);
}

export function normalizeSchools(payload: unknown): School[] {
  return unwrapArray<any>(payload, ['schools', 'data'], 'school list').map((school) => {
    const id = school?.id ?? school?.schoolId;
    const name = school?.name ?? school?.schoolName;
    if (!validId(id) || typeof name !== 'string') {
      throw new Error('The activation service returned an invalid school record.');
    }
    return { id, name };
  });
}

export function normalizeDevices(payload: unknown): Device[] {
  return unwrapArray<any>(payload, ['devices', 'data'], 'device list').map((device) => {
    const deviceType = typeof device?.deviceType === 'string' ? device.deviceType.toUpperCase() : '';
    if (!validId(device?.id) || typeof device?.name !== 'string' || typeof device?.serialNumber !== 'string' || !['NFC', 'HYBRID'].includes(deviceType)) {
      throw new Error('The activation service returned an invalid device record.');
    }
    return {
      id: device.id,
      name: device.name,
      serialNumber: device.serialNumber,
      deviceType,
    };
  });
}

export function normalizeStudents(payload: unknown): Student[] {
  return unwrapArray<any>(payload, ['students', 'data'], 'student list').map((student) => {
    if (!validId(student?.id) || typeof student?.firstName !== 'string' || typeof student?.lastName !== 'string') {
      throw new Error('The activation service returned an invalid student record.');
    }
    return {
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      admissionNo: typeof student.admissionNo === 'string' ? student.admissionNo : '',
      className: typeof student.className === 'string' ? student.className : '',
      section: typeof student.section === 'string' ? student.section : '',
    };
  });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `Activation request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body?.error === 'string') message = body.error;
      else if (typeof body?.message === 'string') message = body.message;
    } catch {
      // The HTTP status remains actionable when the response is not JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

async function fetchSchools(): Promise<School[]> {
  return normalizeSchools(await request<unknown>(`${activationBase}/schools`));
}

async function fetchDevices(schoolId: Id): Promise<Device[]> {
  return normalizeDevices(await request<unknown>(`${activationBase}/schools/${encodeURIComponent(schoolId)}/devices`));
}

async function fetchStudents(schoolId: Id, search: string): Promise<Student[]> {
  const query = new URLSearchParams();
  if (search.trim()) query.set('search', search.trim());
  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : '';
  return normalizeStudents(await request<unknown>(
    `${activationBase}/schools/${encodeURIComponent(schoolId)}/students${suffix}`,
  ));
}

async function fetchEid(schoolId: Id, studentId: Id): Promise<EidRecord> {
  const result = await request<unknown>(
    `${activationBase}/schools/${encodeURIComponent(schoolId)}/students/${encodeURIComponent(studentId)}/e-id`,
  );
  return normalizeEidRecord(result);
}

export function normalizeEidRecord(result: unknown): EidRecord {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('The activation service returned an invalid e-ID record.');
  }
  const outer = result as EidRecord;
  const record = outer.data && typeof outer.data === 'object' && !Array.isArray(outer.data)
    ? outer.data as EidRecord
    : outer;
  const student = record.student && typeof record.student === 'object' ? record.student : record;
  if (!field(student, 'id', 'studentId', 'firstName', 'fullName', 'name')) {
    throw new Error('The activation service returned an e-ID without student information.');
  }
  return record;
}

function recordArray(payload: unknown, resource: string): EidRecord[] {
  const entries = unwrapArray<unknown>(payload, [resource, 'records', 'data', 'history'], `${resource} list`);
  if (entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
    throw new Error(`The activation service returned an invalid ${resource} record.`);
  }
  return entries as EidRecord[];
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed. Please try again.';
}

function displayValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

function field(record: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    const value = displayValue(record?.[key]);
    if (value) return value;
  }
  return '';
}

export function extractEidCardDetails(record: EidRecord) {
  const student = record.student ?? record.data?.student ?? record;
  const school = record.school ?? record.data?.school ?? {};
  const card = record.card ?? record.nfcCard ?? record.cardAssignment ?? student.card ?? {};
  const fullName = field(student, 'fullName', 'name') ||
    [field(student, 'firstName'), field(student, 'lastName')].filter(Boolean).join(' ');
  const photo = field(student, 'photoUrl', 'passportPhotoUrl', 'passportUrl', 'profilePhotoUrl', 'profilePhoto', 'photo');
  const photoStudentId = field(student, 'id', 'studentId') || field(record, 'studentId');
  const photoSchoolId = field(school, 'id', 'schoolId') || field(record, 'schoolId');
  const version = typeof record.__photoVersion === 'number' ? record.__photoVersion : 0;
  const currentPhotoUrl = photo.startsWith('/objects/student-photos/') && photoStudentId && photoSchoolId
    ? `/api/students/${encodeURIComponent(photoStudentId)}/photo?schoolId=${encodeURIComponent(photoSchoolId)}`
    : photo;
  const currentLogoUrl = field(school, 'logoUrl', 'logo', 'schoolLogoUrl') || field(record, 'schoolLogo');
  const freshUrl = (url: string) => url && version
    ? `${url}${url.includes('?') ? '&' : '?'}v=${version}`
    : url;
  return {
    student,
    school,
    fullName,
    schoolName: field(school, 'name', 'schoolName') || field(record, 'schoolName'),
    logo: freshUrl(currentLogoUrl),
    photo: freshUrl(currentPhotoUrl),
    studentId: field(student, 'id', 'studentId') || field(record, 'studentId'),
    admissionNo: field(student, 'admissionNo', 'admissionNumber'),
    className: field(student, 'className', 'class'),
    section: field(student, 'section', 'sectionName'),
    cardNumber: field(card, 'cardNumber', 'number', 'uid', 'reference') || field(record, 'cardNumber', 'nfcCardNumber'),
    session: field(school, 'currentSession', 'sessionName') || field(record, 'sessionName', 'session'),
    qr: field(student, 'qrCodeUrl', 'qrUrl') || field(card, 'qrCodeUrl', 'qrUrl') || field(record, 'qrCodeUrl'),
  };
}

function EidCardPreview({ record }: { record: EidRecord }) {
  const details = extractEidCardDetails(record);
  return (
    <div className="activation-print-area mx-auto w-full max-w-md rounded-2xl border-2 border-[hsl(var(--primary))] bg-white p-5 text-slate-900 shadow-lg" data-testid="activation-eid-preview">
      <div className="mb-4 flex items-center gap-3 border-b border-slate-200 pb-3">
        {details.logo ? <img src={details.logo} alt={`${details.schoolName || 'School'} logo`} className="h-12 w-12 object-contain" data-testid="img-eid-school-logo" /> : null}
        <div className="min-w-0">
          <div className="font-bold" data-testid="text-eid-school">{details.schoolName || 'School'}</div>
          <div className="text-xs uppercase tracking-wider text-slate-500">Student Identification</div>
        </div>
      </div>
      <div className="flex gap-4">
        {details.photo ? (
          <img src={details.photo} alt={`${details.fullName || 'Student'} passport photo`} className="h-28 w-24 shrink-0 rounded-lg border border-slate-200 object-cover" data-testid="img-eid-student-photo" />
        ) : (
          <div className="grid h-28 w-24 shrink-0 place-items-center rounded-lg bg-slate-100 text-center text-xs text-slate-500">No photo on file</div>
        )}
        <div className="min-w-0 space-y-2 text-sm">
          <div className="text-xl font-bold" data-testid="text-eid-student-name">{details.fullName || 'Student'}</div>
          {details.studentId && <div><strong>Student ID:</strong> {details.studentId}</div>}
          {details.admissionNo && <div><strong>Admission No.:</strong> {details.admissionNo}</div>}
          <div><strong>Class:</strong> {[details.className, details.section].filter(Boolean).join(' ') || '—'}</div>
          <div><strong>NFC Card:</strong> {details.cardNumber || '—'}</div>
          {details.session && <div><strong>Session:</strong> {details.session}</div>}
        </div>
      </div>
      {details.qr && <img src={details.qr} alt="Student identification QR code" className="ml-auto mt-3 h-16 w-16 object-contain" data-testid="img-eid-qr" />}
    </div>
  );
}

export function EidActivationPage() {
  const queryClient = useQueryClient();
  const [schoolId, setSchoolId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [search, setSearch] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [eid, setEid] = useState<EidRecord | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [printAfterRefresh, setPrintAfterRefresh] = useState(false);
  const selectionVersion = useRef(0);
  const printVersion = useRef<number | null>(null);

  const schoolsQuery = useQuery({ queryKey: schoolsKey, queryFn: fetchSchools });
  const devicesQuery = useQuery({
    queryKey: ['activation', 'devices', schoolId],
    queryFn: () => fetchDevices(schoolId),
    enabled: !!schoolId,
  });
  const studentsQuery = useQuery({
    queryKey: ['activation', 'students', schoolId, search.trim()],
    queryFn: () => fetchStudents(schoolId, search),
    enabled: !!schoolId && !!deviceId,
  });

  useEffect(() => {
    if (!devicesQuery.data) return;
    if (devicesQuery.data.length === 1) setDeviceId(String(devicesQuery.data[0].id));
    else if (!devicesQuery.data.some((device) => String(device.id) === deviceId)) setDeviceId('');
  }, [devicesQuery.data, deviceId]);

  useEffect(() => {
    if (printAfterRefresh && eid) {
      const version = printVersion.current;
      setPrintAfterRefresh(false);
      const images = Array.from(document.querySelectorAll<HTMLImageElement>('.activation-print-area img'));
      void Promise.all(images.map(async (image) => {
        if (typeof image.decode === 'function') await image.decode();
        else if (!image.complete) await new Promise<void>((resolve, reject) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => reject(new Error('An e-ID image could not be loaded.')), { once: true });
        });
        if (!image.naturalWidth) throw new Error('An e-ID image could not be loaded.');
      })).then(() => {
        if (version === selectionVersion.current) window.print();
      }).catch((error) => {
        if (version === selectionVersion.current) {
          setPreviewError(`${messageOf(error)} Printing was cancelled.`);
        }
      });
    }
  }, [eid, printAfterRefresh]);

  const selectedDevice = devicesQuery.data?.find((device) => String(device.id) === deviceId);
  const selectedStudent = studentsQuery.data?.find((student) => String(student.id) === studentId);

  const assign = useMutation({
    mutationFn: (selection: { schoolId: string; deviceId: Id; studentId: Id; cardNumber: string; selectionVersion: number }) =>
      request<unknown>(`${activationBase}/schools/${encodeURIComponent(selection.schoolId)}/assign`, {
        method: 'POST',
        body: JSON.stringify({ deviceId: selection.deviceId, studentId: selection.studentId, cardNumber: selection.cardNumber }),
      }),
    onSuccess: async (_result, selection) => {
      await queryClient.invalidateQueries({ queryKey: ['activation', 'history', selection.schoolId] });
      if (selection.selectionVersion !== selectionVersion.current) return;
      setConfirmation(`Card ${selection.cardNumber} was assigned successfully.`);
      setEid(null);
      setPreviewError('');
      setPreviewLoading(true);
      try {
        const fresh = await fetchEid(selection.schoolId, selection.studentId);
        if (selection.selectionVersion === selectionVersion.current) setEid(fresh);
      } catch (error) {
        if (selection.selectionVersion === selectionVersion.current) {
          setPreviewError(`The card was assigned, but the updated e-ID could not be loaded: ${messageOf(error)}`);
        }
      } finally {
        if (selection.selectionVersion === selectionVersion.current) setPreviewLoading(false);
      }
    },
  });

  const selectSchool = (value: string) => {
    selectionVersion.current += 1;
    setSchoolId(value);
    setDeviceId('');
    setStudentId('');
    setSearch('');
    setCardNumber('');
    setConfirmation('');
    setPreviewError('');
    setEid(null);
    assign.reset();
  };

  const generatePrint = async () => {
    if (!schoolId || !selectedStudent) return;
    const currentVersion = selectionVersion.current;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const fresh = await fetchEid(schoolId, selectedStudent.id);
      if (currentVersion !== selectionVersion.current) return;
      setEid({ ...fresh, __photoVersion: Date.now() });
      printVersion.current = currentVersion;
      setPrintAfterRefresh(true);
    } catch (error) {
      if (currentVersion === selectionVersion.current) setPreviewError(`Could not refresh the e-ID before printing: ${messageOf(error)}`);
    } finally {
      if (currentVersion === selectionVersion.current) setPreviewLoading(false);
    }
  };

  const canAssign = !!schoolId && !!selectedDevice && !!selectedStudent && !!cardNumber.trim() && !assign.isPending;
  const devices = devicesQuery.data ?? [];
  const students = useMemo(() => studentsQuery.data ?? [], [studentsQuery.data]);

  return (
    <div className="fade-up">
      <style>{`@media print { body * { visibility: hidden !important; } .activation-print-area, .activation-print-area * { visibility: visible !important; } .activation-print-area { position: fixed; inset: 0 auto auto 0; margin: 24px; width: 340px; } .activation-print-actions { display: none !important; } }`}</style>
      <PageHeading
        eyebrow="Secure operations / NFC"
        title="Card Activation."
        description="Assign a physical NFC card to a student in an authorized school and generate their current e-ID."
        action={<div className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--muted-foreground))]"><ShieldCheck size={17} /> Authorized activation</div>}
      />

      {schoolsQuery.isLoading ? <SkeletonPage /> : schoolsQuery.isError ? (
        <p role="alert" data-testid="activation-schools-error" className="rounded-xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.08)] p-4 text-sm text-[hsl(var(--destructive))]">
          Authorized schools could not be loaded: {messageOf(schoolsQuery.error)}
              <Button className="ml-3" variant="outline" onClick={() => schoolsQuery.refetch()} testId="button-retry-activation-schools">Retry</Button>
        </p>
      ) : (schoolsQuery.data?.length ?? 0) === 0 ? (
        <EmptyState icon={GraduationCap} title="No authorized schools" description="No school is currently available to this activation officer." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,.8fr)]">
          <section className="panel space-y-5 p-5 md:p-7" aria-label="Card activation steps">
            <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))]"><CreditCard size={18} /></span><h2 className="display-font text-xl font-bold">Assign an NFC card</h2></div>
            <Field label="1. Authorized school">
              <select disabled={assign.isPending} value={schoolId} onChange={(event) => selectSchool(event.target.value)} data-testid="select-activation-school">
                <option value="">Select a school</option>
                {schoolsQuery.data?.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
              </select>
            </Field>

            {schoolId && (
              devicesQuery.isLoading ? <p role="status" className="text-sm text-[hsl(var(--muted-foreground))]">Loading linked NFC devices…</p> :
              devicesQuery.isError ? <p role="alert" className="text-sm text-[hsl(var(--destructive))]">NFC devices could not be loaded: {messageOf(devicesQuery.error)} <button type="button" data-testid="button-retry-activation-devices" onClick={() => devicesQuery.refetch()} className="underline">Retry</button></p> :
              devices.length === 0 ? <p role="status" className="rounded-xl bg-[hsl(var(--muted)/.5)] p-4 text-sm">No active NFC or hybrid devices are linked to this school.</p> : (
                <>
                  <Field label="2. NFC device">
                    <select disabled={assign.isPending} value={deviceId} onChange={(event) => { selectionVersion.current += 1; setDeviceId(event.target.value); setStudentId(''); setSearch(''); setCardNumber(''); setConfirmation(''); setPreviewError(''); setEid(null); }} data-testid="select-activation-device">
                      {devices.length > 1 && <option value="">Select a device</option>}
                      {devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.deviceType}</option>)}
                    </select>
                  </Field>
                  {selectedDevice && (
                    <Field label="Hardware UID (read from linked device)">
                      <input readOnly value={selectedDevice.serialNumber} className="font-mono bg-[hsl(var(--muted)/.4)]" data-testid="input-hardware-uid" />
                    </Field>
                  )}
                </>
              )
            )}

            {selectedDevice && (
              <>
                <Field label="3. Search same-school student">
                  <input disabled={assign.isPending} value={search} onChange={(event) => { selectionVersion.current += 1; setSearch(event.target.value); setStudentId(''); setCardNumber(''); setConfirmation(''); setEid(null); }} placeholder="Search by student name, admission number, or class" autoComplete="off" data-testid="input-activation-student-search" />
                </Field>
                {studentsQuery.isLoading ? <p role="status" className="text-sm text-[hsl(var(--muted-foreground))]">Searching students…</p> :
                  studentsQuery.isError ? <p role="alert" className="text-sm text-[hsl(var(--destructive))]">Students could not be loaded: {messageOf(studentsQuery.error)} <button type="button" data-testid="button-retry-activation-students" onClick={() => studentsQuery.refetch()} className="underline">Retry</button></p> :
                  students.length === 0 ? <p role="status" className="text-sm text-[hsl(var(--muted-foreground))]">{search.trim() ? 'No matching students in this school.' : 'No students are available in this school.'}</p> : (
                    <Field label="Student">
                      <select disabled={assign.isPending} value={studentId} onChange={(event) => { selectionVersion.current += 1; setStudentId(event.target.value); setCardNumber(''); setConfirmation(''); setPreviewError(''); setEid(null); }} data-testid="select-activation-student">
                        <option value="">Select a student</option>
                        {students.map((student) => <option key={student.id} value={student.id}>
                          {student.firstName} {student.lastName} · ID {student.id}{student.admissionNo ? ` · ${student.admissionNo}` : ''}{student.className ? ` · ${student.className}` : ''}{student.section ? ` ${student.section}` : ''}
                        </option>)}
                      </select>
                    </Field>
                  )}
              </>
            )}

            {selectedStudent && (
                <form onSubmit={(event) => { event.preventDefault(); if (selectedDevice && selectedStudent) assign.mutate({ schoolId, deviceId: selectedDevice.id, studentId: selectedStudent.id, cardNumber: cardNumber.trim(), selectionVersion: selectionVersion.current }); }} className="space-y-5 border-t border-[hsl(var(--border))] pt-5">
                <Field label="4. Physical NFC card number">
                  <input required disabled={assign.isPending} value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} placeholder="Enter or scan card number" autoComplete="off" data-testid="input-activation-card-number" />
                </Field>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">This is the student card number, separate from the hardware UID above.</p>
                {assign.isError && assign.variables?.selectionVersion === selectionVersion.current && <p role="alert" data-testid="activation-assignment-error" className="text-sm text-[hsl(var(--destructive))]">{messageOf(assign.error)}</p>}
                <Button type="submit" disabled={!canAssign} testId="button-assign-nfc-card">
                  <Radio size={16} />{assign.isPending ? 'Assigning card…' : 'Assign Card'}
                </Button>
              </form>
            )}
          </section>

          <section className="space-y-5" aria-label="Updated e-ID">
            <div className="panel p-5 md:p-7">
              <div className="mb-4 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--accent)/.2)] text-[hsl(var(--primary))]"><GraduationCap size={18} /></span><h2 className="display-font text-xl font-bold">Updated student e-ID</h2></div>
              {confirmation && <p role="status" data-testid="activation-confirmation" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{confirmation}</p>}
              {previewLoading && <p role="status" className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Loading the latest saved student, school, photo, and card details…</p>}
              {previewError && <p role="alert" data-testid="activation-preview-error" className="mb-4 text-sm text-[hsl(var(--destructive))]">{previewError}</p>}
              {eid ? <EidCardPreview record={eid} /> : (
                <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
                  After assignment, the latest persisted student e-ID will appear here.
                </div>
              )}
              {eid && (
                <div className="activation-print-actions mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">Uses a fresh e-ID record before opening your browser’s print dialog.</span>
                  <Button onClick={generatePrint} disabled={previewLoading || !selectedStudent} testId="button-generate-send-printing"><Printer size={16} />Generate / Send for Printing</Button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export function ActivationHistoryPage() {
  const [schoolId, setSchoolId] = useState('');
  const schoolsQuery = useQuery({ queryKey: schoolsKey, queryFn: fetchSchools });
  const historyQuery = useQuery({
    queryKey: ['activation', 'history', schoolId],
    queryFn: async () => recordArray(await request<unknown>(
      `${activationBase}/schools/${encodeURIComponent(schoolId)}/history`,
    ), 'history'),
    enabled: !!schoolId,
  });

  return (
    <div className="fade-up">
      <PageHeading eyebrow="Secure operations / NFC" title="Activation History." description="Review recent NFC card assignment activity for an authorized school." />
      {schoolsQuery.isLoading ? <SkeletonPage /> : schoolsQuery.isError ? (
        <p role="alert" className="text-sm text-[hsl(var(--destructive))]">Authorized schools could not be loaded: {messageOf(schoolsQuery.error)}</p>
      ) : !schoolsQuery.data?.length ? (
        <EmptyState icon={FileClock} title="No authorized schools" description="No school is currently available to this activation officer." />
      ) : (
        <div className="space-y-5">
          <Field label="Authorized school">
            <select value={schoolId} onChange={(event) => setSchoolId(event.target.value)} data-testid="select-history-school">
              <option value="">Select a school</option>
              {schoolsQuery.data.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
            </select>
          </Field>
          {!schoolId ? <EmptyState icon={FileClock} title="Choose a school" description="Select an authorized school to view its activation history." /> :
            historyQuery.isLoading ? <SkeletonPage /> :
            historyQuery.isError ? <div role="alert" className="rounded-xl border border-[hsl(var(--destructive)/.25)] p-4 text-sm text-[hsl(var(--destructive))]">Activation history could not be loaded: {messageOf(historyQuery.error)} <button type="button" data-testid="button-retry-activation-history" onClick={() => historyQuery.refetch()} className="ml-2 underline">Retry</button></div> :
            historyQuery.data?.length === 0 ? <EmptyState icon={FileClock} title="No activation history" description="Successful card assignments will appear here." /> : (
              <div className="panel divide-y divide-[hsl(var(--border)/.6)]" data-testid="activation-history-list">
                {historyQuery.data?.map((entry, index) => {
                  const student = entry.student ?? {};
                  const when = field(entry, 'createdAt', 'timestamp', 'assignedAt', 'occurredAt');
                  return (
                    <div key={field(entry, 'id') || index} className="grid gap-2 p-5 sm:grid-cols-[1fr_auto] sm:items-center" data-testid={`activation-history-entry-${field(entry, 'id') || index}`}>
                      <div>
                        <div className="font-semibold">{field(entry, 'action', 'event', 'description') || 'NFC card assignment'}</div>
                        <div className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                          {field(student, 'fullName', 'name') || [field(student, 'firstName'), field(student, 'lastName')].filter(Boolean).join(' ') || field(entry, 'studentName') || 'Student'}
                          {field(entry, 'cardNumber', 'uid') ? ` · Card ${field(entry, 'cardNumber', 'uid')}` : ''}
                        </div>
                      </div>
                      <time className="text-xs text-[hsl(var(--muted-foreground))]" dateTime={when || undefined}>{when ? new Date(when).toLocaleString() : 'Time not provided'}</time>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      )}
    </div>
  );
}