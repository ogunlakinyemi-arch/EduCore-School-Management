import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UsersRound, Plus, Search, Pencil, ArrowRight } from 'lucide-react';
import { 
  useListParents, useCreateParent, useUpdateParent, getListParentsQueryKey,
  useListStudents, getListStudentsQueryKey,
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, TenantPicker, useTenant, cx, useSchoolAdminAccess
} from '@/components/shared';

export function ParentsPage() {
  const { schoolId, setSchoolId } = useTenant();
  const { canManageSchool } = useSchoolAdminAccess();
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
            {canManageSchool && <Button onClick={() => setModal({ create: true })} disabled={!schoolId} testId="button-add-parent">
              <Plus size={16} />Add parent
            </Button>}
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
                {canManageSchool && <div className="flex gap-2">
                  <Button variant="quiet" onClick={() => setModal({ linkChildren: true, parent })} testId={`button-link-parent-children-${parent.id}`}>
                    <ArrowRight size={15} />Link children
                  </Button>
                  <Button variant="quiet" onClick={() => setModal(parent)} testId={`button-edit-parent-${parent.id}`}>
                    <Pencil size={15} />Edit
                  </Button>
                </div>}
              </div>
            )) : (
              <EmptyState 
                icon={UsersRound} 
                title="No parents found" 
                description="Try adjusting your search or add a new parent profile." 
                action={canManageSchool ? <Button onClick={() => setModal({ create: true })} testId="button-empty-add-parent"><Plus size={15} />Add parent</Button> : undefined}
              />
            )}
          </div>
          
          {canManageSchool && modal && (
            <Modal title={modal.linkChildren ? `Link children to ${modal.parent.name}` : modal.create ? 'Register parent' : 'Edit parent profile'} eyebrow="Community Records" onClose={() => setModal(null)}>
              {modal.linkChildren
                ? <ParentChildrenForm schoolId={schoolId} parent={modal.parent} onDone={done} onCancel={() => setModal(null)} />
                : <ParentForm schoolId={schoolId} initial={modal.create ? undefined : modal} onDone={done} onCancel={() => setModal(null)} />}
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

function ParentChildrenForm({ schoolId, parent, onDone, onCancel }: {
  schoolId: number;
  parent: any;
  onDone: () => void;
  onCancel: () => void;
}) {
  const studentsQuery = useListStudents(
    { schoolId, status: 'ACTIVE' },
    { query: { enabled: !!schoolId, queryKey: getListStudentsQueryKey({ schoolId, status: 'ACTIVE' }) } },
  );
  const [selected, setSelected] = useState<number[]>([]);
  const [relationshipType, setRelationshipType] = useState('Guardian');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      const response = await fetch(`/api/parents/${parent.id}/children?schoolId=${schoolId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: selected, relationshipType }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `Could not link children (${response.status})`);
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not link children');
    } finally {
      setPending(false);
    }
  };

  return <form onSubmit={save} className="space-y-4">
    <p className="text-sm text-[hsl(var(--muted-foreground))]">
      Link existing students to this parent profile. This does not create another account or send an invitation.
    </p>
    <Field label="Relationship">
      <select value={relationshipType} onChange={event => setRelationshipType(event.target.value)}>
        <option>Guardian</option><option>Mother</option><option>Father</option><option>Grandparent</option><option>Other</option>
      </select>
    </Field>
    {studentsQuery.isLoading ? <p role="status">Loading school students…</p> : studentsQuery.isError ? (
      <p className="text-sm text-[hsl(var(--destructive))]">Could not load this school&apos;s students.</p>
    ) : (
      <div className="max-h-64 overflow-auto rounded-xl border border-[hsl(var(--border))] p-3 space-y-2">
        {(studentsQuery.data ?? []).map((student: any) => (
          <label key={student.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(student.id)}
              onChange={event => setSelected(current => event.target.checked
                ? [...current, student.id]
                : current.filter(id => id !== student.id))}
            />
            {student.firstName} {student.lastName} · {student.admissionNo} · {student.className}
          </label>
        ))}
        {!(studentsQuery.data ?? []).length && <p className="text-sm text-[hsl(var(--muted-foreground))]">No active students found.</p>}
      </div>
    )}
    {error && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
    <div className="flex justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
      <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      <Button type="submit" disabled={pending || studentsQuery.isLoading || !selected.length}>
        {pending ? 'Linking…' : 'Link selected students'}
      </Button>
    </div>
  </form>;
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