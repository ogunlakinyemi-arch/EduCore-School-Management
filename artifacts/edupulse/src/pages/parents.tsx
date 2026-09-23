import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UsersRound, Plus, Search, Pencil, ArrowRight } from 'lucide-react';
import { 
  useListParents, useCreateParent, useUpdateParent, getListParentsQueryKey 
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, TenantPicker, useTenant, cx
} from '@/components/shared';

export function ParentsPage() {
  const { schoolId, setSchoolId } = useTenant();
  const [search, setSearch] = useState(''); 
  const [modal, setModal] = useState<any>(null); 
  const qc = useQueryClient();
  
  const query = useListParents({ schoolId, search: search || undefined }, { query: { enabled: !!schoolId, queryKey: getListParentsQueryKey({ schoolId, search: search || undefined }) } }); 
  const parents: any[] = query.data ?? [];
  
  const done = () => { 
    setModal(null); 
    qc.invalidateQueries({ queryKey: getListParentsQueryKey() }); 
  };
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Community / Parents" 
        title="Parents & Guardians." 
        description="Manage verified parent profiles and their linked student relationships." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            <Button onClick={() => setModal({ create: true })} disabled={!schoolId} testId="button-add-parent">
              <Plus size={16} />Add parent
            </Button>
          </div>
        } 
      />
      
      {!schoolId ? (
        <EmptyState 
          icon={UsersRound} 
          title="Select a school context" 
          description="You must select a school to view or manage its parent community." 
        />
      ) : query.isLoading ? (
        <SkeletonPage />
      ) : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : (
        <>
          <div className="panel mb-6 flex items-center p-4">
            <label className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-3 text-[hsl(var(--muted-foreground))]" size={18} />
              <input 
                className="pl-11" 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
                placeholder="Search parents by name, email or phone..." 
              />
            </label>
          </div>
          
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[1.5fr_1.5fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
              <span>Parent/Guardian</span>
              <span>Contact</span>
              <span>Linked Children</span>
              <span />
            </div>
            {parents.length ? parents.map((parent: any) => (
              <div key={parent.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1.5fr_1.5fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                <div>
                  <div className="font-bold text-sm text-[hsl(var(--foreground))] flex items-center gap-2">
                    {parent.name}
                    {parent.clerkUserId && <StatusPill value="Verified" />}
                  </div>
                  <div className="mt-1 text-[11px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    {parent.relationshipType || 'Guardian'}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">{parent.email}</div>
                  <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 font-mono">{parent.phone}</div>
                </div>
                <div>
                  <div className="text-sm font-bold flex items-center gap-1.5">
                    <span className="bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] h-6 w-6 rounded-full grid place-items-center">{parent.activeChildren ?? 0}</span>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">enrolled</span>
                  </div>
                </div>
                <Button variant="quiet" onClick={() => setModal(parent)} testId={`button-edit-parent-${parent.id}`}>
                  <Pencil size={15} />Edit
                </Button>
              </div>
            )) : (
              <EmptyState 
                icon={UsersRound} 
                title="No parents found" 
                description="Try adjusting your search or add a new parent profile." 
                action={<Button onClick={() => setModal({ create: true })} testId="button-empty-add-parent"><Plus size={15} />Add parent</Button>} 
              />
            )}
          </div>
          
          {modal && (
            <Modal title={modal.create ? 'Register parent' : 'Edit parent profile'} eyebrow="Community Records" onClose={() => setModal(null)}>
              <ParentForm schoolId={schoolId} initial={modal.create ? undefined : modal} onDone={done} onCancel={() => setModal(null)} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

function ParentForm({ schoolId, initial, onDone, onCancel }: { schoolId: number; initial?: any; onDone: () => void; onCancel: () => void }) {
  const create = useCreateParent(); 
  const update = useUpdateParent(); 
  
  const [form, setForm] = useState({ 
    name: initial?.name ?? '', 
    email: initial?.email ?? '', 
    phone: initial?.phone ?? '', 
    relationshipType: initial?.relationshipType ?? 'Mother', 
    address: initial?.address ?? '',
    status: initial?.status ?? 'ACTIVE'
  });
  
  const save = (e: FormEvent) => { 
    e.preventDefault(); 
    if (initial) {
      update.mutate({ parentId: initial.id, params: { schoolId }, data: form as any }, { onSuccess: onDone }); 
    } else {
      create.mutate({ params: { schoolId }, data: form as any }, { onSuccess: onDone }); 
    }
  };
  
  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-5">
      <Field label="Full Name">
        <input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Parent or guardian name" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Email Address">
          <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email for portal access" />
        </Field>
        <Field label="Phone Number">
          <input required minLength={7} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Mobile number" />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Relationship Type">
          <select value={form.relationshipType} onChange={e => setForm({ ...form, relationshipType: e.target.value })}>
            <option value="Mother">Mother</option>
            <option value="Father">Father</option>
            <option value="Guardian">Guardian</option>
            <option value="Grandparent">Grandparent</option>
            <option value="Other">Other</option>
          </select>
        </Field>
        {initial && (
          <Field label="Status">
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </Field>
        )}
      </div>
      <Field label="Residential Address (Optional)">
        <textarea rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Full home address" />
      </Field>

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save changes' : 'Register parent'}</Button>
      </div>
      {(create.isError || update.isError) && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Could not save this record. Check the fields and try again.</p>}
    </form>
  );
}