import { useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Library, Plus, Search, Pencil } from 'lucide-react';
import { useListClasses, useCreateClass, getListClassesQueryKey } from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, Field, TenantPicker, useTenant, cx } from '@/components/shared';

// Classes page ported from Phase 2 to Phase 3 design
export function ClassesPage() {
  const { schoolId, setSchoolId } = useTenant();
  const [modal, setModal] = useState<any>(null); 
  const qc = useQueryClient();
  
  const query = useListClasses({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListClassesQueryKey({ schoolId }) } }); 
  const classes: any[] = query.data ?? [];
  
  const done = () => { 
    setModal(null); 
    qc.invalidateQueries({ queryKey: getListClassesQueryKey() }); 
  };
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Structure / Classes" 
        title="Class Management." 
        description="Organize students into distinct learning cohorts and sections." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            <Button onClick={() => setModal({ create: true })} disabled={!schoolId}>
              <Plus size={16} />Create class
            </Button>
          </div>
        } 
      />
      
      {!schoolId ? (
        <EmptyState icon={Library} title="Select a school context" description="You must select a school to manage its classes." />
      ) : query.isLoading ? (
        <SkeletonPage />
      ) : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : (
        <>
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[2fr_1fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
              <span>Class Name</span>
              <span>Level/Grade</span>
              <span>Capacity</span>
              <span />
            </div>
            {classes.length ? classes.map((cls: any) => (
              <div key={cls.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[2fr_1fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                <div className="font-bold text-sm text-[hsl(var(--foreground))]">{cls.name}</div>
                <div className="text-sm font-medium text-[hsl(var(--muted-foreground))]">{cls.level || '—'}</div>
                <div className="text-sm font-bold">{cls.capacity ? `${cls.capacity} seats` : 'Unlimited'}</div>
                <div className="flex justify-end"><StatusPill value="Active" /></div>
              </div>
            )) : (
              <EmptyState icon={Library} title="No classes defined" description="Create a class structure to enroll students." action={<Button onClick={() => setModal({ create: true })}><Plus size={15} />Create class</Button>} />
            )}
          </div>
          
          {modal && (
            <Modal title="Create Class" eyebrow="Structure" onClose={() => setModal(null)}>
              <ClassForm schoolId={schoolId} onDone={done} onCancel={() => setModal(null)} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

function ClassForm({ schoolId, onDone, onCancel }: { schoolId: number; onDone: () => void; onCancel: () => void }) {
  const create = useCreateClass(); 
  
  const [form, setForm] = useState({ name: '', level: '', capacity: '' });
  
  const save = (e: FormEvent) => { 
    e.preventDefault(); 
    const payload = { ...form, capacity: form.capacity ? Number(form.capacity) : undefined };
    create.mutate({ params: { schoolId }, data: payload as any }, { onSuccess: onDone }); 
  };
  
  return (
    <form onSubmit={save} className="space-y-5">
      <Field label="Class Name">
        <input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Year 1" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Level / Grade">
          <input value={form.level} onChange={e => setForm({ ...form, level: e.target.value })} placeholder="e.g. Primary" />
        </Field>
        <Field label="Capacity (Optional)">
          <input type="number" min={1} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} placeholder="Max students" />
        </Field>
      </div>
      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Create class'}</Button>
      </div>
    </form>
  );
}