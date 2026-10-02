import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus, ShieldCheck } from 'lucide-react';
import { 
  useGetAuthorizedContext, useListCards, useListStudents, useRegisterCard, useUpdateCardStatus, getListCardsQueryKey
} from '@workspace/api-client-react';
import { OwnerCardLink } from '@/components/owner-card-link';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, Field, TenantPicker, useTenant, cx 
} from '@/components/shared';

// Phase 3 NFC Cards Page
export function CardsPage() {
  const { schoolId, setSchoolId } = useTenant();
  const authorized = useGetAuthorizedContext();
  const roles = authorized.data?.roles?.filter(role => role.status === 'ACTIVE') ?? [];
  const isRestrictedEmployee = roles.some(role =>
    ['DEVICE_ACTIVATION_OFFICER', 'COMPANY_ACCOUNTANT'].includes(String(role.role)));
  const canProvision = authorized.data?.isPlatformOwner === true && !isRestrictedEmployee;
  const canManageCards = canProvision || (!authorized.data?.isPlatformOwner &&
    roles.some(role => role.role === 'SCHOOL_ADMIN' && role.schoolId === schoolId));
  const [modal, setModal] = useState<any>(null); 
  const qc = useQueryClient();
  
  const query = useListCards({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListCardsQueryKey({ schoolId }) } }); 
  const cards: any[] = query.data ?? [];
  const studentsQuery = useListStudents({ schoolId, status: 'all' as any }, {
    query: { enabled: !!schoolId && canManageCards, queryKey: ['cards-reassignment-students', schoolId] }
  });
  const students: any[] = studentsQuery.data ?? [];
  
  const toggleStatus = useUpdateCardStatus();

  const handleToggle = (id: number, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'locked' : 'active';
    toggleStatus.mutate({ cardId: id, data: { status: newStatus as any } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListCardsQueryKey({ schoolId }) })
    });
  };

  const done = () => { 
    setModal(null); 
    qc.invalidateQueries({ queryKey: getListCardsQueryKey() }); 
  };
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Security / NFC Cards" 
        title="NFC Card Management"
        description={canProvision
          ? 'Prepare and manage school-bound physical NFC cards.'
          : 'Manage prepared cards and their student assignments. Physical card provisioning is handled by the platform.'}
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            {canProvision && <Button onClick={() => setModal({ create: true })} disabled={!schoolId}>
              <Plus size={16} />Provision Card
            </Button>}
          </div>
        } 
      />
      
      {canProvision && <OwnerCardLink />}
      {!schoolId ? (
        <EmptyState icon={CreditCard} title="Select a school context" description="You must select a school to manage its hardware fleet." />
      ) : query.isLoading ? (
        <SkeletonPage />
      ) : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : (
        <>
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[1fr_1.5fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
              <span>Card UID</span>
              <span>Assigned To</span>
              <span>Status</span>
              <span />
            </div>
            {cards.length ? cards.map((card: any) => (
              <div key={card.uid} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1fr_1.5fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                <div>
                  <div className="font-mono text-sm font-bold text-[hsl(var(--primary))] dark:text-[hsl(var(--accent))]">{card.uid}</div>
                </div>
                 <div className="text-sm font-medium">{card.employeeName ?? card.studentName ?? (card.employeeId ? `Employee #${card.employeeId}` : card.studentId ? `Student #${card.studentId}` : 'Unassigned')}</div>
                <div><StatusPill value={card.status} /></div>
                 {canManageCards && !card.employeeId && <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setModal({ reassign: card })} disabled={studentsQuery.isLoading || !students.length}>
                    Reassign
                  </Button>
                  <Button variant="outline" onClick={() => handleToggle(card.id, card.status)} disabled={toggleStatus.isPending}>
                    {card.status === 'active' ? 'Lock Card' : 'Unlock Card'}
                  </Button>
                 </div>}
              </div>
            )) : (
              <EmptyState icon={ShieldCheck} title="No NFC cards" description={canProvision ? 'Prepare physical access cards for this school.' : 'Prepared NFC cards will appear here for assignment and management.'} action={canProvision ? <Button onClick={() => setModal({ create: true })}><Plus size={15} />Provision Card</Button> : undefined} />
            )}
          </div>
          
           {modal && canManageCards && (!modal.create || canProvision) && (
            <Modal
              title={modal.create ? 'Provision NFC Card' : 'Reassign NFC Card'}
              eyebrow="Hardware Management"
              onClose={() => setModal(null)}
            >
              {modal.create ? (
                <CardForm schoolId={schoolId} onDone={done} onCancel={() => setModal(null)} />
              ) : (
                <CardReassignForm
                  card={modal.reassign}
                  students={students}
                  onCancel={() => setModal(null)}
                />
              )}
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

function CardReassignForm({
  card, students, onCancel,
}: {
  card: any;
  students: any[];
  onCancel: () => void;
}) {
  const [studentId, setStudentId] = useState('');
  const [resultMessage, setResultMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const qc = useQueryClient();
  const reassign = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/cards/${card.id}/reassign`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: Number(studentId) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'Card reassignment failed');
      return payload;
    },
    onSuccess: (updated: any) => {
      setErrorMessage('');
      setResultMessage(`Card ${updated.uid} reassigned to ${updated.studentName}.`);
      qc.invalidateQueries({ queryKey: getListCardsQueryKey() });
      qc.invalidateQueries({ queryKey: ['cards-reassignment-students'] });
    },
    onError: (error: Error) => {
      setResultMessage('');
      setErrorMessage(error.message || 'Card reassignment failed');
    },
  });

  const save = (event: FormEvent) => {
    event.preventDefault();
    setResultMessage('');
    setErrorMessage('');
    reassign.mutate();
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Assign <span className="font-mono font-bold text-[hsl(var(--foreground))]">{card.uid}</span> to a student in this school.
      </p>
      <Field label="Same-school student">
        <select required value={studentId} onChange={(event) => setStudentId(event.target.value)}>
          <option value="">Select a student</option>
          {students.map((student: any) => (
            <option key={student.id} value={student.id}>
              {student.firstName} {student.lastName} · {student.admissionNo}
            </option>
          ))}
        </select>
      </Field>
      {resultMessage && <p role="status" className="text-sm font-semibold text-emerald-600">{resultMessage}</p>}
      {errorMessage && <p role="alert" className="text-sm font-semibold text-red-600">{errorMessage}</p>}
      <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-5">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={reassign.isPending || !studentId}>
          {reassign.isPending ? 'Reassigning…' : 'Reassign Card'}
        </Button>
      </div>
    </form>
  );
}

function CardForm({ schoolId, onDone, onCancel }: { schoolId: number; onDone: () => void; onCancel: () => void }) {
  const create = useRegisterCard(); 
  
  const [form, setForm] = useState({ uid: '', studentId: '' });
  
  const save = (e: FormEvent) => { 
    e.preventDefault(); 
    create.mutate({ params: { schoolId }, data: { uid: form.uid, studentId: Number(form.studentId) } as any }, { onSuccess: onDone }); 
  };
  
  return (
    <form onSubmit={save} className="space-y-5">
      <Field label="Hardware UID">
        <input required minLength={4} value={form.uid} onChange={e => setForm({ ...form, uid: e.target.value.toUpperCase() })} placeholder="e.g. A1B2C3D4" className="font-mono uppercase" />
      </Field>
      <Field label="Target Student ID">
        <input required type="number" min={1} value={form.studentId} onChange={e => setForm({ ...form, studentId: e.target.value })} placeholder="Numeric ID" />
      </Field>
      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Provisioning…' : 'Register Card'}</Button>
      </div>
    </form>
  );
}