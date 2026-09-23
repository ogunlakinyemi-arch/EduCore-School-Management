import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus, ShieldCheck } from 'lucide-react';
import { 
  useListCards, useRegisterCard, useUpdateCardStatus, getListCardsQueryKey 
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, Field, TenantPicker, useTenant, cx 
} from '@/components/shared';

// Phase 3 NFC Cards Page
export function CardsPage() {
  const { schoolId, setSchoolId } = useTenant();
  const [modal, setModal] = useState<any>(null); 
  const qc = useQueryClient();
  
  const query = useListCards({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListCardsQueryKey({ schoolId }) } }); 
  const cards: any[] = query.data ?? [];
  
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
        title="Access Control Fleet." 
        description="Provision and manage student physical access cards." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            <Button onClick={() => setModal({ create: true })} disabled={!schoolId}>
              <Plus size={16} />Provision Card
            </Button>
          </div>
        } 
      />
      
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
                <div className="text-sm font-medium">Student ID: {card.studentId}</div>
                <div><StatusPill value={card.status} /></div>
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => handleToggle(card.id, card.status)} disabled={toggleStatus.isPending}>
                    {card.status === 'active' ? 'Lock Card' : 'Unlock Card'}
                  </Button>
                </div>
              </div>
            )) : (
              <EmptyState icon={ShieldCheck} title="No cards provisioned" description="Register hardware access cards to students." action={<Button onClick={() => setModal({ create: true })}><Plus size={15} />Provision Card</Button>} />
            )}
          </div>
          
          {modal && (
            <Modal title="Provision NFC Card" eyebrow="Hardware Management" onClose={() => setModal(null)}>
              <CardForm schoolId={schoolId} onDone={done} onCancel={() => setModal(null)} />
            </Modal>
          )}
        </>
      )}
    </div>
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