import { useState, type FormEvent } from 'react';
import { useLocation, useParams, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { 
  Building2, Plus, Search, Pencil, ArrowLeft, GraduationCap, ShieldCheck, 
  CircleAlert, BarChart3, CreditCard 
} from 'lucide-react';
import { 
  useListSchools, useGetSchool, useCreateSchool, useUpdateSchool, 
  useGetSchoolDashboard, getListSchoolsQueryKey 
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, Info, Metric, ActivityFeed, cx, date, time 
} from '@/components/shared';

export function SchoolsPage() {
  const [search, setSearch] = useState(''); 
  const [status, setStatus] = useState('all'); 
  const [modal, setModal] = useState<any>(null); 
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  
  const query = useListSchools({ search: search || undefined, status: status as any }); 
  const schools: any[] = query.data ?? [];
  
  const done = () => { 
    setModal(null); 
    qc.invalidateQueries({ queryKey: getListSchoolsQueryKey() }); 
  };
  
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Platform / schools" 
        title="Schools in your orbit." 
        description="Keep every operator visible, while keeping every tenant safely separate." 
        action={
          <Button onClick={() => setModal({ create: true })} testId="button-add-school">
            <Plus size={16} />Add school
          </Button>
        } 
      />
      
      <div className="panel mb-6 flex flex-col gap-4 p-4 md:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-4 top-3 text-[hsl(var(--muted-foreground))]" size={18} />
          <input 
            className="pl-11" 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Search by school, city or code..." 
            data-testid="input-search-schools" 
          />
        </label>
        <div className="flex gap-2 overflow-auto pb-1 md:pb-0">
          {['all', 'active', 'attention', 'suspended'].map(item => (
            <button 
              key={item} 
              onClick={() => setStatus(item === 'attention' ? 'inactive' : item)} 
              className={cx(
                'whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-bold capitalize transition-all', 
                status === (item === 'attention' ? 'inactive' : item) 
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md' 
                  : 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:bg-[hsl(var(--muted))]'
              )} 
              data-testid={`filter-school-${item}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      
      <div className="panel overflow-hidden">
        <div className="hidden grid-cols-[1.5fr_1fr_.8fr_.8fr_.8fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
          <span>School</span>
          <span>Location</span>
          <span>Students</span>
          <span>Staff</span>
          <span>Subscription</span>
          <span />
        </div>
        {schools.length ? schools.map((school: any) => (
          <div key={school.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1.5fr_1fr_.8fr_.8fr_.8fr_auto] md:items-center md:gap-4 md:px-6">
            <div>
              <Link href={`/schools/${school.id}`} className="font-bold text-sm hover:text-[hsl(var(--primary))] transition-colors" data-testid={`link-school-${school.id}`}>
                {school.name}
              </Link>
              <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                <span className="font-mono bg-[hsl(var(--secondary))] px-1.5 py-0.5 rounded text-[10px]">{school.code}</span>
                <StatusPill value={school.status} />
              </div>
            </div>
            <div className="text-sm text-[hsl(var(--muted-foreground))] font-medium">{school.city}, {school.state}</div>
            <div className="text-sm font-bold">{school.studentCount?.toLocaleString() ?? 0}</div>
            <div className="text-sm font-bold">{school.staffCount ?? 0}</div>
            <div><StatusPill value={school.subscriptionStatus} /></div>
            <Button variant="quiet" onClick={() => setModal(school)} testId={`button-edit-school-${school.id}`}>
              <Pencil size={15} />Edit
            </Button>
          </div>
        )) : (
          <EmptyState 
            icon={Building2} 
            title="No schools match that view" 
            description="Try another status or add the next school to your network." 
            action={<Button onClick={() => setModal({ create: true })} testId="button-empty-add-school"><Plus size={15} />Add a school</Button>} 
          />
        )}
      </div>
      
      {modal && (
        <Modal title={modal.create ? 'Add a new school' : 'Edit school profile'} eyebrow="Tenant setup" onClose={() => setModal(null)}>
          <SchoolForm initial={modal.create ? undefined : modal} onDone={done} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </div>
  );
}

function SchoolForm({ initial, onDone, onCancel }: { initial?: any; onDone: () => void; onCancel: () => void }) {
  const create = useCreateSchool();
  const update = useUpdateSchool();
  
  const [form, setForm] = useState({ 
    code: initial?.code ?? '',
    name: initial?.name ?? '', 
    city: initial?.city ?? '', 
    state: initial?.state ?? '', 
    status: initial?.status ?? 'active' 
  });
  
  const pending = create.isPending || update.isPending;
  
  const save = (event: FormEvent) => { 
    event.preventDefault(); 
    if (initial) {
      update.mutate({ schoolId: initial.id, data: form }, { onSuccess: onDone }); 
    } else {
      create.mutate({ data: form }, { onSuccess: onDone }); 
    }
  };

  return (
    <form onSubmit={save} className="space-y-5">
      {!initial && (
        <Field label="School Code (Unique identifier)">
          <input required minLength={2} maxLength={10} value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. CGA" data-testid="input-school-code" className="font-mono uppercase" />
        </Field>
      )}
      <Field label="School name">
        <input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cedar Grove Academy" data-testid="input-school-name" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="City">
          <input required value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Lagos" data-testid="input-school-city" />
        </Field>
        <Field label="State">
          <input required value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} placeholder="Lagos" data-testid="input-school-state" />
        </Field>
      </div>
      <Field label="Operational status">
        <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} data-testid="select-school-status">
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="inactive">Inactive</option>
        </select>
      </Field>
      <div className="flex justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel} testId="button-cancel-school">Cancel</Button>
        <Button type="submit" disabled={pending} testId="button-save-school">{pending ? 'Saving…' : initial ? 'Save changes' : 'Create school'}</Button>
      </div>
      {(create.isError || update.isError) && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Could not save this school. Check the fields and try again.</p>}
    </form>
  );
}

export function SchoolOverview() {
  const params = useParams<{ id: string }>(); 
  const [, setLocation] = useLocation(); 
  const schoolId = Number(params.id); 
  
  const schoolQuery = useGetSchool(schoolId); 
  const dash = useGetSchoolDashboard({ schoolId });
  
  if (schoolQuery.isLoading || dash.isLoading) return <SkeletonPage />; 
  if (schoolQuery.isError || dash.isError) return <ErrorState retry={() => { schoolQuery.refetch(); dash.refetch(); }} />;
  
  const school: any = schoolQuery.data; 
  const data: any = dash.data;

  return (
    <div className="fade-up">
      <Link href="/schools" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]" data-testid="link-back-schools">
        <ArrowLeft size={16} />Back to all schools
      </Link>
      
      <PageHeading 
        eyebrow={`School / ${school?.code}`} 
        title={school?.name ?? 'School overview'} 
        description={`${school?.city}, ${school?.state} · joined ${date(school?.createdAt)}`} 
        action={
          <Button variant="outline" onClick={() => setLocation('/students')} testId="button-open-school-directory">
            <GraduationCap size={16} />Open directory
          </Button>
        } 
      />
      
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total students" value={data?.totalStudents ?? 0} detail={`${data?.activeStudents ?? 0} currently active`} icon={GraduationCap} accent />
        <Metric label="Unpaid students" value={data?.unpaidStudents ?? 0} detail="Need subscription follow-up" icon={CircleAlert} />
        <Metric label="Attendance" value="Not available" detail="Attendance is planned for a later phase" icon={BarChart3} accent />
        <Metric label="Active cards" value={data?.activeCards ?? 0} detail={`${data?.lockedCards ?? 0} locked`} icon={CreditCard} />
      </div>
      
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="panel p-6 md:p-8">
          <div className="eyebrow mb-2">Tenant context</div>
          <h2 className="display-font text-2xl font-bold mb-6">Operational snapshot</h2>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <Info label="School code" value={<span className="font-mono">{school?.code}</span>} />
            <Info label="School status" value={<StatusPill value={school?.status} />} />
            <Info label="Subscription health" value={<StatusPill value={school?.subscriptionStatus} />} />
            <Info label="Staff on record" value={school?.staffCount ?? 0} />
          </div>
          
          <div className="mt-6 rounded-2xl bg-[hsl(var(--secondary))] p-5 border border-[hsl(var(--border))]">
            <div className="flex items-center gap-2.5 text-sm font-bold text-[hsl(var(--foreground))]">
              <ShieldCheck size={18} className="text-[hsl(var(--primary))]" />
              Data boundary is active
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
              Students, payments and card events shown here belong only to {school?.name}.
            </p>
          </div>
        </div>
        
        <div className="panel p-6 md:p-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <div className="eyebrow">School activity</div>
              <h2 className="display-font mt-2 text-2xl font-bold">Recent movement</h2>
            </div>
            <Link href="/audit" className="text-sm font-bold text-[hsl(var(--primary))] hover:underline" data-testid="link-school-audit">Full trail</Link>
          </div>
          <ActivityFeed items={data?.recentActivity} />
        </div>
      </div>
    </div>
  );
}