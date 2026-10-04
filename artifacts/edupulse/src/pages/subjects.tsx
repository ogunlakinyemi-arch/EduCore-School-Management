import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Pencil, Link2 } from 'lucide-react';
import { 
  useListSubjects, useCreateSubject, useUpdateSubject, getListSubjectsQueryKey,
  useListClassSubjectAssignments, useAssignClassSubject, getListClassSubjectAssignmentsQueryKey
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, TenantPicker, useTenant, cx, useSchoolAdminAccess
} from '@/components/shared';

export function SubjectsPage() {
  const { schoolId, setSchoolId } = useTenant();
  const { canManageSchool } = useSchoolAdminAccess();
  const [modal, setModal] = useState<any>(null); 
  const qc = useQueryClient();
  
  const query = useListSubjects({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListSubjectsQueryKey({ schoolId }) } }); 
  const subjects: any[] = query.data ?? [];
  
  const done = () => { 
    setModal(null); 
    qc.invalidateQueries({ queryKey: getListSubjectsQueryKey() }); 
  };
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Structure / Subjects" 
        title="Curriculum Subjects." 
        description="Define subjects and map them to classes and teachers." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            {canManageSchool && <Button onClick={() => setModal({ create: true })} disabled={!schoolId}>
              <Plus size={16} />Add subject
            </Button>}
          </div>
        } 
      />
      
      {!schoolId ? (
        <EmptyState 
          icon={BookOpen} 
          title="Select a school context" 
          description="You must select a school to manage its curriculum." 
        />
      ) : query.isLoading ? (
        <SkeletonPage />
      ) : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : (
        <>
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[2fr_1fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
              <span>Subject</span>
              <span>Code</span>
              <span>Status</span>
              <span />
            </div>
            {subjects.length ? subjects.map((subject: any) => (
              <div key={subject.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[2fr_1fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                <div>
                  <div className="font-bold text-sm text-[hsl(var(--foreground))]">
                    {subject.name}
                  </div>
                  {subject.description && <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">{subject.description}</div>}
                </div>
                <div>
                  <span className="font-mono bg-[hsl(var(--secondary))] px-2 py-1 rounded text-xs text-[hsl(var(--secondary-foreground))] font-bold">{subject.code}</span>
                </div>
                <div>
                  <StatusPill value={subject.status} />
                </div>
                {canManageSchool && <div className="flex items-center gap-2">
                  {/* Future phase: assignment mapping directly from subject row */}
                  <Button variant="quiet" onClick={() => setModal(subject)}>
                    <Pencil size={15} />Edit
                  </Button>
                </div>}
              </div>
            )) : (
              <EmptyState 
                icon={BookOpen} 
                title="No subjects defined" 
                description="Begin building the curriculum by adding subjects." 
                action={canManageSchool ? <Button onClick={() => setModal({ create: true })}><Plus size={15} />Add subject</Button> : undefined}
              />
            )}
          </div>
          
          {canManageSchool && modal && (
            <Modal title={modal.create ? 'Add Subject' : 'Edit Subject'} eyebrow="Curriculum" onClose={() => setModal(null)}>
              <SubjectForm schoolId={schoolId} initial={modal.create ? undefined : modal} onDone={done} onCancel={() => setModal(null)} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

function SubjectForm({ schoolId, initial, onDone, onCancel }: { schoolId: number; initial?: any; onDone: () => void; onCancel: () => void }) {
  const create = useCreateSubject(); 
  const update = useUpdateSubject(); 
  
  const [form, setForm] = useState({ 
    name: initial?.name ?? '', 
    code: initial?.code ?? '', 
    description: initial?.description ?? '', 
    status: initial?.status ?? 'ACTIVE'
  });
  
  const save = (e: FormEvent) => { 
    e.preventDefault(); 
    if (initial) {
      update.mutate({ subjectId: initial.id, params: { schoolId }, data: form as any }, { onSuccess: onDone }); 
    } else {
      create.mutate({ params: { schoolId }, data: { name: form.name, description: form.description, status: form.status } }, { onSuccess: onDone });
    }
  };
  
  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-[1fr_120px]">
        <Field label="Subject Name">
          <input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mathematics" />
        </Field>
        <Field label="Subject Code">
          <input readOnly value={form.code} placeholder="Generated on save" className="font-mono uppercase" />
        </Field>
      </div>
      
      <Field label="Description (Optional)">
        <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Brief syllabus overview..." />
      </Field>

      {initial && (
        <Field label="Status">
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>
      )}

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save changes' : 'Add subject'}</Button>
      </div>
      {(create.isError || update.isError) && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Could not save this record. Check for duplicate codes.</p>}
    </form>
  );
}