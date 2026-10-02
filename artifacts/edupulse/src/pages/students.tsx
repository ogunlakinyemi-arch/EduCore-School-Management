import { useEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { 
  GraduationCap, Plus, Search, Pencil, ArrowLeft, UsersRound, Calendar, 
  MapPin, Phone 
} from 'lucide-react';
import { 
  useListStudents, useCreateStudent, useUpdateStudent, 
  getListStudentsQueryKey, useGetSchool, getGetSchoolQueryKey,
  getStudent, getSchool, listCards
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, Info, TenantPicker, useTenant, cx, date, useSchoolAdminAccess
} from '@/components/shared';
import { StudentPhotoField } from '@/components/student-photo-field';

export function StudentsPage() {
  const { schoolId, setSchoolId } = useTenant();
  const [search, setSearch] = useState(''); 
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'TRANSFERRED'>('ACTIVE');
  const [modal, setModal] = useState<any>(null); 
  const [idCardStudent, setIdCardStudent] = useState<any>(null);
  const qc = useQueryClient();
  const { canManageSchool } = useSchoolAdminAccess();
  const schoolQuery = useGetSchool(schoolId, { query: { enabled: !!schoolId, queryKey: getGetSchoolQueryKey(schoolId) } });
  const school = schoolQuery.data;
  
  const query = useListStudents({ schoolId, search: search || undefined, status }, { query: { enabled: !!schoolId, queryKey: getListStudentsQueryKey({ schoolId, search: search || undefined, status }) } });
  const students: any[] = query.data ?? [];
  
  const done = () => { 
    setModal(null); 
    qc.invalidateQueries({ queryKey: getListStudentsQueryKey() }); 
  };
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Directory / Students" 
        title="Student Directory." 
        description="Search, filter, and manage all student records within the selected tenant context." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            {canManageSchool && <Button onClick={() => setModal({ create: true })} disabled={!schoolId} testId="button-add-student">
              <Plus size={16} />Add student
            </Button>}
          </div>
        } 
      />
      
      {!schoolId ? (
        <EmptyState 
          icon={GraduationCap} 
          title="Select a school context" 
          description="You must select a school to view or manage its students." 
        />
      ) : query.isLoading ? (
        <SkeletonPage />
      ) : query.isError ? (
        <ErrorState
          retry={() => query.refetch()}
          message={(query.error as { status?: number } | null)?.status === 400
            ? "The selected school or student filters were rejected. Check your selection and retry."
            : "Student records could not be loaded. Retry when your connection is ready."}
        />
      ) : (
        <>
          <div className="panel mb-6 flex flex-col gap-4 p-4 md:flex-row">
            <label className="relative flex-1">
              <Search className="absolute left-4 top-3 text-[hsl(var(--muted-foreground))]" size={18} />
              <input 
                className="pl-11" 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
                placeholder="Search by name, admission number, or class..." 
                data-testid="input-search-students" 
              />
            </label>
            <div className="flex gap-2 overflow-auto pb-1 md:pb-0">
              {(['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED'] as const).map(item => (
                <button 
                  key={item} 
                  onClick={() => setStatus(item)} 
                  className={cx(
                    'whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-bold capitalize transition-all', 
                    status === item
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md' 
                      : 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:bg-[hsl(var(--muted))]'
                  )} 
                  data-testid={`filter-student-${item.toLowerCase()}`}
                >
                  {item.toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
              <span>Student</span>
              <span>Class</span>
              <span>Parent/Guardian</span>
              <span>Status</span>
              <span />
            </div>
            {students.length ? students.map((student: any) => (
              <div key={student.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                <div>
                  <div className="font-bold text-sm text-[hsl(var(--foreground))]">
                    {student.firstName} {student.lastName}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                    <span className="font-mono bg-[hsl(var(--secondary))] px-1.5 py-0.5 rounded text-[10px]">{student.admissionNo}</span>
                    <span>{date(student.joinedAt)}</span>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-bold">{student.className}</div>
                  <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">{student.section}</div>
                </div>
                <div>
                  <div className="text-sm font-medium">{student.parentName || '—'}</div>
                  {student.parentPhone && <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">{student.parentPhone}</div>}
                </div>
                <div>
                  <StatusPill value={student.status} />
                  <div className="mt-1"><StatusPill value={student.subscriptionStatus} /></div>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <Button variant="quiet" onClick={() => setIdCardStudent(student)} testId={`button-student-id-card-${student.id}`}>e-ID card</Button>
                  {canManageSchool && <Button variant="quiet" onClick={() => setModal(student)} testId={`button-edit-student-${student.id}`}>
                    <Pencil size={15} />Edit
                  </Button>}
                </div>
              </div>
            )) : (
              <EmptyState 
                icon={GraduationCap} 
                title="No students found" 
                description="Try adjusting your filters or add a new student to this school." 
                action={canManageSchool ? <Button onClick={() => setModal({ create: true })} testId="button-empty-add-student"><Plus size={15} />Add student</Button> : undefined}
              />
            )}
          </div>
          
          {canManageSchool && modal && (
            <Modal title={modal.create ? 'Admit new student' : 'Edit student profile'} eyebrow="Student Records" onClose={() => setModal(null)}>
              <StudentForm schoolId={schoolId} initial={modal.create ? undefined : modal} onDone={done} onCancel={() => setModal(null)} />
            </Modal>
          )}
          {idCardStudent && (
            <Modal title="Student e-ID card" eyebrow="Printable student identification" onClose={() => setIdCardStudent(null)}>
              <StudentEIdCard studentId={idCardStudent.id} schoolId={schoolId} onClose={() => setIdCardStudent(null)} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

type EIdSnapshot = {
  student: any;
  school: any;
  card: any | null;
  logoSrc: string | null;
  passportSrc: string | null;
};

function withEIdRefreshToken(src: string, token: number): string {
  const hashIndex = src.indexOf('#');
  const path = hashIndex === -1 ? src : src.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : src.slice(hashIndex);
  return `${path}${path.includes('?') ? '&' : '?'}eidRefresh=${token}${hash}`;
}

function getPassportSource(student: any, schoolId: number, token: number): string | null {
  const passportUrl = student.passportUrl;
  if (!passportUrl) return null;
  const source = passportUrl.startsWith('/objects/student-photos/')
    ? `/api/students/${student.id}/photo?schoolId=${schoolId}`
    : passportUrl;
  return withEIdRefreshToken(source, token);
}

async function waitForImage(image: HTMLImageElement | null): Promise<void> {
  if (!image) return;
  if (!image.complete) {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => reject(new Error(`Could not load ${image.alt || 'an e-ID image'}.`)), { once: true });
    });
  }
  if (image.naturalWidth === 0) throw new Error(`Could not load ${image.alt || 'an e-ID image'}.`);
  if (typeof image.decode === 'function') await image.decode();
}

function StudentEIdCard({ studentId, schoolId, onClose }: { studentId: number; schoolId: number; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<EIdSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  const refresh = async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError('');
    setSnapshot(null);
    try {
      const [student, school, cards] = await Promise.all([
        getStudent(studentId, { schoolId }),
        getSchool(schoolId),
        listCards({ schoolId }),
      ]);
      if (request !== requestId.current) return null;
      const currentCard = cards.find((card: any) =>
        Number(card.studentId) === student.id && String(card.status).toLowerCase() === 'active',
      ) ?? null;
      const freshSnapshot = {
        student,
        school,
        card: currentCard,
        logoSrc: school.logoUrl ? withEIdRefreshToken(school.logoUrl, request) : null,
        passportSrc: getPassportSource(student, schoolId, request),
      };
      setSnapshot(freshSnapshot);
      return freshSnapshot;
    } catch {
      if (request === requestId.current) {
        setSnapshot(null);
        setError('The latest student, school, and card information could not be loaded. Retry before printing.');
      }
      return null;
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    return () => { requestId.current += 1; };
  }, [studentId, schoolId]);

  const printLatest = async () => {
    setPrinting(true);
    try {
      const freshSnapshot = await refresh();
      if (!freshSnapshot) return;
      flushSync(() => setSnapshot(freshSnapshot));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const images = Array.from(cardRef.current?.querySelectorAll('img') ?? []);
      await Promise.all(images.map(image => waitForImage(image)));
      window.print();
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error ? cause.message : 'An e-ID image could not be loaded. Printing was cancelled.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <>
      <style>{`@media print { body * { visibility: hidden !important; } .student-eid-card, .student-eid-card * { visibility: visible !important; } .student-eid-card { position: fixed; inset: 0 auto auto 0; margin: 24px; width: 340px; } .student-eid-actions { display: none !important; } }`}</style>
      {loading && <p role="status" className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">Loading the latest student e-ID…</p>}
      {error && <p role="alert" className="py-4 text-sm font-medium text-[hsl(var(--destructive))]">{error}</p>}
      {snapshot && (
        <div ref={cardRef} className="student-eid-card mx-auto w-full max-w-sm rounded-2xl border-2 border-[hsl(var(--primary))] bg-white p-5 text-slate-900 shadow-lg">
          <div className="mb-4 flex items-center gap-3 border-b border-slate-200 pb-3">
            {snapshot.logoSrc ? <img src={snapshot.logoSrc} alt={`${snapshot.school.name} logo`} className="h-12 w-12 object-contain" /> : <div className="grid h-12 w-12 place-items-center rounded-lg bg-slate-100 text-xs font-bold">Logo</div>}
            <div><div className="font-bold">{snapshot.school.name || 'School'}</div><div className="text-xs uppercase tracking-wider text-slate-500">Student Identification</div></div>
          </div>
          <div className="flex gap-4">
            {snapshot.passportSrc ? <img src={snapshot.passportSrc} alt={`${snapshot.student.firstName} ${snapshot.student.lastName} passport photo`} className="h-24 w-20 rounded-lg bg-slate-100 object-cover" /> : <div className="grid h-24 w-20 place-items-center rounded-lg bg-slate-100 text-center text-xs text-slate-500">No photo</div>}
            <div className="space-y-2 text-sm">
              <div className="text-xl font-bold">{snapshot.student.firstName} {snapshot.student.lastName}</div>
              <div><strong>Admission No.:</strong> {snapshot.student.admissionNo || '—'}</div>
              <div><strong>Student ID:</strong> {snapshot.student.id}</div>
              <div><strong>Active Card UID:</strong> {snapshot.card?.uid || '—'}</div>
            </div>
          </div>
        </div>
      )}
      <div className="student-eid-actions mt-5 flex justify-end gap-3">
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button onClick={printLatest} disabled={loading || printing || !snapshot}>{printing ? 'Preparing…' : 'Print / Save as PDF'}</Button>
      </div>
    </>
  );
}

function StudentForm({ schoolId, initial, onDone, onCancel }: { schoolId: number; initial?: any; onDone: () => void; onCancel: () => void }) {
  const create = useCreateStudent(); 
  const update = useUpdateStudent(); 
  const queryClient = useQueryClient();
  const [contactPending, setContactPending] = useState(false);
  const [contactError, setContactError] = useState('');
  
  const [form, setForm] = useState({ 
    admissionNo: initial?.admissionNo ?? '', 
    email: initial?.email ?? '',
    firstName: initial?.firstName ?? '', 
    lastName: initial?.lastName ?? '', 
    gender: initial?.gender ?? 'female', 
    className: initial?.className ?? '', 
    section: initial?.section ?? '', 
    parentName: initial?.parentName ?? '', 
    parentPhone: initial?.parentPhone ?? '', 
    status: initial?.status ?? 'ACTIVE' 
  });
  
  const save = async (e: FormEvent) => {
    e.preventDefault(); 
    if (initial) {
      setContactError('');
      setContactPending(true);
      try {
        const response = await fetch(`/api/students/${initial.id}/contact?schoolId=${schoolId}`, {
          method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: form.email.trim() || null }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error || `Could not update student email (${response.status})`);
        update.mutate({ studentId: initial.id, params: { schoolId }, data: { firstName: form.firstName, lastName: form.lastName, className: form.className, section: form.section, status: form.status as any } }, { onSuccess: onDone });
      } catch (error) {
        setContactError(error instanceof Error ? error.message : 'Could not update student email');
      } finally {
        setContactPending(false);
      }
    } else {
      create.mutate({ params: { schoolId }, data: {
        ...form,
        admissionNo: form.admissionNo.trim() || undefined,
        email: form.email.trim() || null,
      } as any }, { onSuccess: onDone });
    }
  };
  
  const pending = create.isPending || update.isPending || contactPending;

  return (
    <form onSubmit={save} className="space-y-5">
      {!initial && (
        <Field label="Admission Number">
          <input minLength={2} value={form.admissionNo} onChange={e => setForm({ ...form, admissionNo: e.target.value })} placeholder="Leave blank to generate automatically" className="font-mono" />
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">School admission numbers are generated automatically unless you provide an existing number.</p>
        </Field>
      )}
      <Field label="Student Email (optional, for portal activation)">
        <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="student@example.edu" />
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Activation uses the email saved on this student profile; it cannot be re-entered in the invitation form.</p>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First Name">
          <input required minLength={2} value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} placeholder="First name" />
        </Field>
        <Field label="Last Name">
          <input required minLength={2} value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} placeholder="Last name" />
        </Field>
      </div>
      
      {!initial && (
        <Field label="Gender">
          <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </Field>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Class">
          <input required value={form.className} onChange={e => setForm({ ...form, className: e.target.value })} placeholder="e.g. Year 1" />
        </Field>
        <Field label="Section">
          <input required value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} placeholder="e.g. A" />
        </Field>
      </div>
      {initial && (
        <StudentPhotoField
          schoolId={schoolId}
          studentId={initial.id}
          passportUrl={initial.passportUrl}
          onUpdated={() => {
            void queryClient.invalidateQueries({ queryKey: getListStudentsQueryKey() });
          }}
        />
      )}

      {!initial && (
        <div className="grid gap-5 sm:grid-cols-2 pt-4 border-t border-[hsl(var(--border))]">
          <Field label="Parent/Guardian Name">
            <input value={form.parentName} onChange={e => setForm({ ...form, parentName: e.target.value })} placeholder="Full name" />
          </Field>
          <Field label="Parent Phone">
            <input value={form.parentPhone} onChange={e => setForm({ ...form, parentPhone: e.target.value })} placeholder="Phone number" />
          </Field>
        </div>
      )}

      {initial && (
        <Field label="Enrollment Status">
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="GRADUATED">Graduated</option>
            <option value="TRANSFERRED">Transferred</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
        </Field>
      )}

      {contactError && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{contactError}</p>}
      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save changes' : 'Admit student'}</Button>
      </div>
      {(create.isError || update.isError) && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Could not save this record. Check the fields and try again.</p>}
    </form>
  );
}