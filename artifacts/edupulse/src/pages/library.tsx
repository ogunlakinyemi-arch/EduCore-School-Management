import { useState } from 'react';
import { useGetAuthorizedContext, useGetStudentSelfProfile, getGetStudentSelfProfileQueryKey } from '@workspace/api-client-react';
import { BookOpen, LibraryBig, BookCopy, Clock3, History, Settings2, ChartNoAxesColumn, RotateCcw, CornerDownLeft, Search, ChevronRight, BookmarkPlus, Tag, UserRoundPlus } from 'lucide-react';
import { AddButton, RecordDialog, StatusLine, WorkspaceIntro, WorkspaceList, WorkspaceTabs, phase9Input, phase9Label, type FormField } from '@/components/phase9-workspace';
import { toPayload, useLibraryAction, usePhase9List } from '@/hooks/use-phase9-api';
import { Button, EmptyState, ErrorState, Metric, PageHeading, SkeletonPage, StatusPill, TenantPicker, date, useTenant } from '@/components/shared';

type Area = 'catalogue' | 'loans' | 'overdue' | 'directory' | 'reports' | 'settings';
type Book = { id: number; schoolId: number; title: string; subtitle: string | null; isbn: string | null; authorId: number | null; authorName: string | null; publisherId: number | null; publisherName: string | null; categoryId: number | null; categoryName: string | null; subject: string | null; description: string | null; publicationYear: number | null; edition: string | null; coverReference: string | null; language: string; shelfLocation: string | null; status: string; totalCopies: number; availableCopies: number };
type Copy = { id: number; bookId: number; copyCode: string; barcode: string | null; condition: string; status: string; location: string | null; acquiredOn: string | null };
export type Loan = { id: number; bookTitle: string; bookId: number; copyId: number; copyCode: string; borrowerType: string; borrowerUserId: number; borrowerStudentId: number | null; borrowerFirstName?: string; borrowerLastName?: string; status: string; issuedAt: string; dueOn: string; returnedAt: string | null; renewalCount: number; overdue: boolean; daysOverdue: number };
type DirectoryRow = { id: number; name: string; description?: string | null; reference?: string | null; isActive?: boolean };
type Settings = Record<string, number | boolean> & { studentBorrowingEnabled: boolean; teacherBorrowingEnabled: boolean; staffBorrowingEnabled: boolean; maxBooksPerStudent: number; maxBooksPerTeacher: number; maxBooksPerStaff: number; studentLoanDays: number; teacherLoanDays: number; staffLoanDays: number; maxRenewals: number; renewalRequiresNotOverdue: boolean; finesEnabled: boolean };
const bookFields: FormField[] = [
  { key: 'title', label: 'Title', required: true }, { key: 'subtitle', label: 'Subtitle' }, { key: 'isbn', label: 'ISBN' },
  { key: 'authorId', label: 'Author', type: 'select' }, { key: 'publisherId', label: 'Publisher', type: 'select' },
  { key: 'categoryId', label: 'Category', type: 'select' }, { key: 'subject', label: 'Subject' },
  { key: 'publicationYear', label: 'Publication year', type: 'number', min: 1000, max: 2200 }, { key: 'edition', label: 'Edition' },
  { key: 'language', label: 'Language' }, { key: 'shelfLocation', label: 'Shelf / location' },
  { key: 'coverReference', label: 'Cover reference' }, { key: 'description', label: 'Description', type: 'textarea' },
];
const settingsFields: FormField[] = [
  { key: 'studentBorrowingEnabled', label: 'Student borrowing enabled', type: 'checkbox' },
  { key: 'teacherBorrowingEnabled', label: 'Teacher borrowing enabled', type: 'checkbox' },
  { key: 'staffBorrowingEnabled', label: 'Staff borrowing enabled', type: 'checkbox' },
  ...(['Student', 'Teacher', 'Staff'] as const).flatMap(type => [
    { key: `maxBooksPer${type}`, label: `Maximum books per ${type.toLowerCase()}`, type: 'number' as const, min: 1, max: 50 },
    { key: `${type.toLowerCase()}LoanDays`, label: `${type} loan period (days)`, type: 'number' as const, min: 1, max: 180 },
  ]),
  { key: 'maxRenewals', label: 'Maximum renewals', type: 'number', min: 0, max: 20 },
  { key: 'renewalRequiresNotOverdue', label: 'Block overdue renewals', type: 'checkbox' },
];
const options = (rows: DirectoryRow[] | undefined) => (rows ?? []).map(row => ({ value: String(row.id), label: row.name }));

export function LibraryPage({ initialArea = 'catalogue' }: { initialArea?: 'catalogue' | 'loans' }) {
  const { schoolId } = useTenant();
  const context = useGetAuthorizedContext().data;
  const roles = context?.roles?.filter(role => role.schoolId === schoolId && role.status === 'ACTIVE').map(role => role.role) ?? [];
  const admin = !context?.isPlatformOwner && roles.includes('SCHOOL_ADMIN');
  // The report is manager-only on the server. An assigned librarian can use the
  // circulation workspace without receiving School Admin catalogue controls.
  const managerAccess = usePhase9List<Report>('library/reports', schoolId, {}, !admin && !context?.isPlatformOwner && roles.some(role => role === 'TEACHER' || role === 'STAFF'));
  const manager = admin || managerAccess.isSuccess;
  const [area, setArea] = useState<Area>(initialArea);
  if (!schoolId) return <><PageHeading eyebrow="School / Learning resources" title="Library." description="A living catalogue of what your school can read and borrow." action={<TenantPicker />} /><EmptyState icon={LibraryBig} title="Choose a school" description="Select an authorized school to open its library." /></>;
  if (context?.isPlatformOwner || !roles.some(role => ['SCHOOL_ADMIN', 'TEACHER', 'STAFF', 'STUDENT'].includes(role))) return <div className="panel p-8" role="alert">Library access is not available for your role at this school.</div>;
  const tabs: { id: Area; label: string }[] = [{ id: 'catalogue', label: 'Catalogue' }, { id: 'loans', label: manager ? 'Borrowing & history' : 'My loans' },
    ...(manager ? [{ id: 'overdue' as const, label: 'Overdue' }, { id: 'reports' as const, label: 'Reports' }] : []),
    ...(admin ? [{ id: 'directory' as const, label: 'Authors & categories' }, { id: 'settings' as const, label: 'Loan rules' }] : []),
  ];
  return <div className="fade-up"><PageHeading eyebrow="School / Learning resources" title="Library." description="Find a title, follow its copies, and keep every borrowing record in view." action={<TenantPicker />} />
    <div className="relative mb-6 overflow-hidden rounded-2xl bg-[hsl(var(--sidebar))] px-7 py-8 text-[hsl(var(--sidebar-foreground))] md:px-10">
      <div className="eyebrow text-[hsl(var(--accent))]">The school collection</div><h2 className="display-font mt-2 max-w-xl text-3xl font-bold">Every book has a place. Every reader has a story.</h2>
      <p className="mt-3 max-w-lg text-sm leading-6 opacity-70">Explore the catalogue, see what is on the shelf and keep track of what is due back.</p>
      <BookOpen size={180} strokeWidth={.6} className="pointer-events-none absolute -bottom-14 right-3 rotate-[-14deg] opacity-10" />
    </div>
    <WorkspaceTabs items={tabs} active={area} onChange={id => setArea(id as Area)} />
    {area === 'catalogue' ? <Catalogue key={schoolId} schoolId={schoolId} admin={admin} userId={context?.user?.id ?? 0} role={roles.includes('STUDENT') ? 'STUDENT' : roles.includes('TEACHER') ? 'TEACHER' : roles.includes('STAFF') ? 'STAFF' : null} /> :
      area === 'loans' ? <Loans key={`${schoolId}-${area}`} schoolId={schoolId} admin={manager} currentUserId={context?.user?.id ?? 0} /> :
      area === 'overdue' && manager ? <Loans key={`${schoolId}-${area}`} schoolId={schoolId} admin currentUserId={context?.user?.id ?? 0} overdue /> :
      area === 'directory' && admin ? <Directory schoolId={schoolId} /> :
      area === 'reports' && manager ? <LibraryReports schoolId={schoolId} /> :
      area === 'settings' && admin ? <LibrarySettings schoolId={schoolId} /> : null}
  </div>;
}

function Catalogue({ schoolId, admin, userId, role }: { schoolId: number; admin: boolean; userId: number; role: 'STUDENT' | 'TEACHER' | 'STAFF' | null }) {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [availability, setAvailability] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Book | null>(null);
  const [editing, setEditing] = useState<Book | 'new' | null>(null);
  const [failure, setFailure] = useState('');
  const query = usePhase9List<{ items: Book[]; schoolId: number; limit: number; offset: number }>('library/books', schoolId, { limit: '50', offset: String(offset), ...(search ? { q: search } : {}), ...(categoryId ? { categoryId } : {}), ...(availability ? { availability } : {}) });
  const authors = usePhase9List<DirectoryRow[]>('library/authors', schoolId);
  const publishers = usePhase9List<DirectoryRow[]>('library/publishers', schoolId);
  const categories = usePhase9List<DirectoryRow[]>('library/categories', schoolId);
  const action = useLibraryAction(schoolId);
  const fields = bookFields.map(field => ({ ...field, options: field.key === 'authorId' ? options(authors.data) : field.key === 'publisherId' ? options(publishers.data) : field.key === 'categoryId' ? options(categories.data) : field.options }));
  const save = async (values: Record<string, string | number | boolean | null>) => {
    try {
      const payload = toPayload(values, ['authorId', 'publisherId', 'categoryId', 'publicationYear'], editing !== 'new');
      if (payload.language === null) delete payload.language;
      await action.mutateAsync({ path: editing === 'new' ? 'books' : `books/${editing?.id}`, method: editing === 'new' ? 'POST' : 'PATCH', data: payload });
      setEditing(null); setFailure('');
    }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Book could not be saved.'); }
  };
  return <div className="space-y-5"><section className="panel p-4 md:p-5"><div className="flex flex-wrap gap-3">
    <label className="relative min-w-[230px] flex-1"><Search size={17} className="absolute left-3 top-3 text-[hsl(var(--muted-foreground))]" /><span className="sr-only">Search catalogue</span><input data-testid="input-library-search" className={`${phase9Input} pl-10`} placeholder="Title, author, ISBN, subject or copy code" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} /></label>
    <label className="min-w-40"><span className="sr-only">Category</span><select data-testid="select-library-category" className={phase9Input} value={categoryId} onChange={event => { setCategoryId(event.target.value); setOffset(0); }}><option value="">All categories</option>{categories.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    <label className="min-w-40"><span className="sr-only">Availability</span><select data-testid="select-library-availability" className={phase9Input} value={availability} onChange={event => { setAvailability(event.target.value); setOffset(0); }}><option value="">All books</option><option value="AVAILABLE">On shelf</option><option value="UNAVAILABLE">Unavailable</option></select></label>
  </div></section>
  <WorkspaceList index="library-catalogue" title="Catalogue" empty="No titles match this search. Try a different title, author, subject or category." rows={query.data?.items} loading={query.isLoading} error={query.isError} retry={() => void query.refetch()} action={admin && <AddButton label="Add book" onClick={() => { setEditing('new'); setFailure(''); }} />}
    render={book => <div className="flex flex-wrap items-center gap-4"><span className="grid h-12 w-10 shrink-0 place-items-center rounded-r-lg rounded-l-sm bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]"><BookOpen size={21} /></span><div className="min-w-[170px] flex-1"><strong className="block">{book.title}</strong><span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">{[book.authorName, book.categoryName, book.isbn && `ISBN ${book.isbn}`, book.shelfLocation].filter(Boolean).join(' · ') || 'Unclassified title'}</span></div><div className="text-right"><strong className="text-sm">{book.availableCopies} / {book.totalCopies}</strong><span className="block text-[11px] text-[hsl(var(--muted-foreground))]">available copies</span></div><Button variant="outline" onClick={() => setSelected(book)} testId={`button-open-book-${book.id}`}>View <ChevronRight size={15} /></Button></div>}
  />
  {query.data?.items.length === 50 && <div className="flex justify-end gap-2"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button><Button variant="outline" onClick={() => setOffset(offset + 50)}>Next page</Button></div>}
  {offset > 0 && query.data?.items.length !== 50 && <Button variant="outline" onClick={() => setOffset(Math.max(0, offset - 50))}>Previous page</Button>}
  {selected && <BookDetail key={selected.id} book={selected} schoolId={schoolId} admin={admin} userId={userId} role={role} onClose={() => setSelected(null)} onEdit={() => { setEditing(selected); setSelected(null); }} />}
  {editing && <RecordDialog key={editing === 'new' ? 'new-book' : editing.id} title={editing === 'new' ? 'Add a book' : 'Edit book'} fields={editing === 'new' ? fields : [...fields, { key: 'status', label: 'Catalogue status', type: 'select', options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }] }]} values={editing === 'new' ? {} : editing as unknown as Record<string, string | number | boolean | null>} onClose={() => setEditing(null)} onSave={save} pending={action.isPending} error={failure} />}
  </div>;
}

function BookDetail({ book, schoolId, admin, userId, role, onClose, onEdit }: { book: Book; schoolId: number; admin: boolean; userId: number; role: 'STUDENT' | 'TEACHER' | 'STAFF' | null; onClose: () => void; onEdit: () => void }) {
  const copies = usePhase9List<Copy[]>(`library/books/${book.id}/copies`, schoolId);
  const profile = useGetStudentSelfProfile({ query: { enabled: role === 'STUDENT', queryKey: getGetStudentSelfProfileQueryKey() } });
  const action = useLibraryAction(schoolId);
  const [addCopy, setAddCopy] = useState(false);
  const [failure, setFailure] = useState('');
  const [changing, setChanging] = useState<Copy | null>(null);
  const selfStudentId = role === 'STUDENT' ? profile.data?.id : undefined;
  const issue = async (copy: Copy) => {
    if (!userId || !role || role === 'STUDENT' && !selfStudentId) return;
    if (!window.confirm(`Borrow ${book.title} (${copy.copyCode})? Your school's borrowing rules will apply.`)) return;
    try { await action.mutateAsync({ path: 'loans', data: { copyId: copy.id, borrowerType: role, borrowerUserId: userId, ...(role === 'STUDENT' ? { borrowerStudentId: selfStudentId } : {}), idempotencyKey: crypto.randomUUID() } }); setFailure(''); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not borrow this copy.'); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--foreground)/.3)] p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-label={book.title} className="panel max-h-[90dvh] w-full max-w-2xl overflow-y-auto p-6 shadow-2xl md:p-8">
    <div className="flex justify-between gap-5"><div><div className="eyebrow">Catalogue / {book.categoryName ?? 'Book'}</div><h2 className="display-font mt-2 text-2xl font-bold">{book.title}</h2>{book.subtitle && <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{book.subtitle}</p>}</div><Button variant="quiet" onClick={onClose}>Close</Button></div>
    <p className="mt-4 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{book.description || 'No description has been added yet.'}</p>
    <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-[hsl(var(--secondary)/.45)] p-4 text-xs sm:grid-cols-3">{[['Author', book.authorName], ['Publisher', book.publisherName], ['ISBN', book.isbn], ['Subject', book.subject], ['Shelf', book.shelfLocation], ['Language', book.language]].map(([label, value]) => <div key={label}><div className="eyebrow">{label}</div><strong className="mt-1 block">{value || '—'}</strong></div>)}</div>
    {admin && <div className="mt-5 flex flex-wrap gap-2"><Button variant="outline" onClick={onEdit}>Edit title</Button><AddButton label="Register copy" onClick={() => setAddCopy(true)} /></div>}
    <div className="mt-7 flex items-center justify-between"><h3 className="display-font text-xl font-bold">Physical copies</h3><span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">{book.availableCopies} on shelf</span></div>
    {copies.isLoading ? <SkeletonPage /> : copies.isError ? <ErrorState retry={() => void copies.refetch()} /> : !copies.data?.length ? <EmptyState icon={BookCopy} title="No copies registered" description="A title needs a physical copy before it can be borrowed." /> : <div className="mt-3 divide-y divide-[hsl(var(--border))]">{copies.data.map(copy => <div key={copy.id} className="flex flex-wrap items-center gap-3 py-3"><span className="min-w-0 flex-1"><strong className="block font-mono text-xs">{copy.copyCode}</strong><span className="text-xs text-[hsl(var(--muted-foreground))]">{[copy.barcode, copy.location, phase9Label(copy.condition)].filter(Boolean).join(' · ')}</span></span><StatusPill value={copy.status} />{copy.status === 'AVAILABLE' && role && <Button variant="outline" disabled={action.isPending || role === 'STUDENT' && !selfStudentId} onClick={() => void issue(copy)} testId={`button-borrow-copy-${copy.id}`}><BookmarkPlus size={14} />Borrow</Button>}{admin && <Button variant="quiet" onClick={() => setChanging(copy)}>Update status</Button>}</div>)}</div>}
    {failure && <p role="alert" className="mt-4 text-sm text-[hsl(var(--destructive))]">{failure}</p>}
    {addCopy && <RecordDialog title="Register a copy" fields={[{ key: 'copyCode', label: 'Unique copy code', required: true }, { key: 'barcode', label: 'Barcode' }, { key: 'location', label: 'Location' }, { key: 'condition', label: 'Condition', type: 'select', options: ['NEW', 'GOOD', 'FAIR', 'POOR'].map(value => ({ value, label: phase9Label(value) })) }, { key: 'acquiredOn', label: 'Acquired on', type: 'date' }, { key: 'acquisitionReference', label: 'Acquisition reference' }]} values={{}} onClose={() => setAddCopy(false)} pending={action.isPending} error={failure} onSave={async values => { try { await action.mutateAsync({ path: `books/${book.id}/copies`, data: toPayload(values) }); setAddCopy(false); setFailure(''); } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not register copy.'); } }} />}
    {changing && <CopyStatus copy={changing} schoolId={schoolId} onClose={() => setChanging(null)} />}
  </section></div>;
}

function CopyStatus({ copy, schoolId, onClose }: { copy: Copy; schoolId: number; onClose: () => void }) {
  const action = useLibraryAction(schoolId);
  const history = usePhase9List<{ id: number; previousStatus: string; newStatus: string; reason: string; createdAt: string }[]>(`library/copies/${copy.id}/history`, schoolId);
  const [failure, setFailure] = useState('');
  return <RecordDialog title={`Copy ${copy.copyCode}`} fields={[
    { key: 'status', label: 'New status', type: 'select', required: true, options: ['AVAILABLE', 'LOST', 'DAMAGED', 'MAINTENANCE', 'RETIRED'].map(value => ({ value, label: phase9Label(value) })) },
    { key: 'reason', label: 'Reason', required: true }, { key: 'notes', label: 'Notes', type: 'textarea' },
  ]} values={{ status: copy.status }} onClose={onClose} pending={action.isPending} error={failure} footer={<div className="border-t border-[hsl(var(--border))] pt-4"><div className="eyebrow mb-2">Status history</div>{history.isLoading ? <div className="h-8 animate-pulse rounded-lg bg-[hsl(var(--muted))]" /> : history.isError ? <Button variant="quiet" onClick={() => void history.refetch()}>Retry history</Button> : history.data?.length ? <div className="max-h-28 space-y-2 overflow-auto">{history.data.map(item => <div key={item.id} className="flex justify-between gap-3 text-xs"><span>{phase9Label(item.previousStatus)} → {phase9Label(item.newStatus)} · {item.reason}</span><span className="shrink-0 text-[hsl(var(--muted-foreground))]">{date(item.createdAt)}</span></div>)}</div> : <p className="text-xs text-[hsl(var(--muted-foreground))]">No changes recorded yet.</p>}</div>} onSave={async values => { try { await action.mutateAsync({ path: `copies/${copy.id}/status`, method: 'PATCH', data: toPayload(values) }); onClose(); } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not update copy.'); } }} />;
}

export function Loans({ schoolId, admin, currentUserId, overdue = false, childId }: { schoolId: number; admin: boolean; currentUserId: number; overdue?: boolean; childId?: number }) {
  const query = usePhase9List<Loan[]>(overdue ? 'library/overdue' : 'library/loans', schoolId, { limit: '200' });
  const action = useLibraryAction(schoolId);
  const [failure, setFailure] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [returning, setReturning] = useState<Loan | null>(null);
  const [history, setHistory] = useState(false);
  const rows = query.data?.filter(loan => (!childId || loan.borrowerStudentId === childId) && (history || overdue || loan.status === 'OPEN'));
  const renew = async (loan: Loan) => {
    if (!window.confirm(`Renew ${loan.bookTitle}? School renewal limits will apply.`)) return;
    try { await action.mutateAsync({ path: `loans/${loan.id}/renew`, data: { idempotencyKey: crypto.randomUUID() } }); setFailure(''); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Renewal could not be completed.'); }
  };
  return <div className="space-y-4">
    {!overdue && <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><input type="checkbox" data-testid="checkbox-loan-history" checked={history} onChange={event => setHistory(event.target.checked)} />Include returned loans</label>{admin && <AddButton label="Issue a book" onClick={() => setIssuing(true)} />}</div>}
    {overdue && admin && <Button variant="outline" disabled={action.isPending} onClick={async () => { if (!window.confirm('Queue overdue reminders through the school communication service? Existing reminders will not be duplicated.')) return; try { const result = await action.mutateAsync({ path: 'overdue/notifications' }) as { notificationsQueued: number }; setFailure(`${result.notificationsQueued} reminder${result.notificationsQueued === 1 ? '' : 's'} queued.`); } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not queue reminders.'); } }}>Queue overdue reminders</Button>}
    {failure && <p role="status" className="rounded-xl bg-[hsl(var(--secondary))] p-3 text-sm">{failure}</p>}
    <WorkspaceList index={overdue ? 'library-overdue' : 'library-loans'} title={overdue ? 'Overdue loans' : 'Borrowing ledger'} empty={overdue ? 'No overdue loans. Every active loan is still within its due date.' : 'Borrowed books and your return history will appear here.'} rows={rows} loading={query.isLoading} error={query.isError} retry={() => void query.refetch()}
      render={loan => <div className="flex flex-wrap items-center gap-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))]"><BookOpen size={18} /></span><div className="min-w-[190px] flex-1"><strong>{loan.bookTitle}</strong><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{loan.copyCode} · Due {date(loan.dueOn)}{admin ? ` · ${loan.borrowerFirstName ? `${loan.borrowerFirstName} ${loan.borrowerLastName}` : `User #${loan.borrowerUserId}`}` : ''}</p></div><StatusLine value={loan.overdue ? 'OVERDUE' : loan.status} detail={loan.overdue ? `${loan.daysOverdue} days late` : `${loan.renewalCount} renewals`} />{loan.status === 'OPEN' && (admin || loan.borrowerUserId === currentUserId) && <div className="flex gap-2"><Button variant="outline" disabled={action.isPending} onClick={() => void renew(loan)} testId={`button-renew-loan-${loan.id}`}><RotateCcw size={14} />Renew</Button><Button variant="outline" onClick={() => setReturning(loan)} testId={`button-return-loan-${loan.id}`}><CornerDownLeft size={14} />Return</Button></div>}</div>}
    />
    {issuing && <RecordDialog title="Issue a book" fields={[
      { key: 'copyId', label: 'Physical copy ID', type: 'number', required: true, min: 1 },
      { key: 'borrowerType', label: 'Borrower type', type: 'select', required: true, options: ['STUDENT', 'TEACHER', 'STAFF'].map(value => ({ value, label: phase9Label(value) })) },
      { key: 'borrowerUserId', label: 'Borrower user ID', type: 'number', required: true, min: 1 },
      { key: 'borrowerStudentId', label: 'Student ID (student loans only)', type: 'number', min: 1 },
      { key: 'dueOn', label: 'Override due date', type: 'date' }, { key: 'notes', label: 'Issue notes', type: 'textarea' },
    ]} values={{}} onClose={() => setIssuing(false)} pending={action.isPending} error={failure} onSave={async values => { try { await action.mutateAsync({ path: 'loans', data: { ...toPayload(values, ['copyId', 'borrowerUserId', 'borrowerStudentId']), idempotencyKey: crypto.randomUUID() } }); setIssuing(false); setFailure(''); } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not issue this copy.'); } }} />}
    {returning && <RecordDialog title={`Return ${returning.bookTitle}`} fields={[{ key: 'copyStatus', label: 'Copy condition on return', type: 'select', options: [{ value: 'AVAILABLE', label: 'Available' }, { value: 'DAMAGED', label: 'Damaged' }] }, { key: 'reason', label: 'Reason (if damaged)' }, { key: 'notes', label: 'Return notes', type: 'textarea' }]} values={{ copyStatus: 'AVAILABLE' }} onClose={() => setReturning(null)} pending={action.isPending} error={failure} onSave={async values => { try { await action.mutateAsync({ path: `loans/${returning.id}/return`, data: toPayload(values) }); setReturning(null); setFailure(''); } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not return this copy.'); } }} />}
  </div>;
}

function Directory({ schoolId }: { schoolId: number }) {
  const [kind, setKind] = useState<'categories' | 'authors' | 'publishers'>('categories');
  const [editing, setEditing] = useState<DirectoryRow | 'new' | null>(null);
  const [failure, setFailure] = useState('');
  const query = usePhase9List<DirectoryRow[]>(`library/${kind}`, schoolId);
  const action = useLibraryAction(schoolId);
  return <div className="space-y-5"><WorkspaceTabs items={[{ id: 'categories', label: 'Categories' }, { id: 'authors', label: 'Authors' }, { id: 'publishers', label: 'Publishers' }]} active={kind} onChange={id => setKind(id as typeof kind)} />
    <WorkspaceList index={`library-${kind}`} title={phase9Label(kind)} empty={`Add a ${kind.slice(0, -1)} to organize your catalogue.`} rows={query.data} loading={query.isLoading} error={query.isError} retry={() => void query.refetch()} action={<AddButton label={`Add ${kind.slice(0, -1)}`} onClick={() => { setEditing('new'); setFailure(''); }} />} render={row => <div className="flex items-center gap-3"><Tag size={18} className="text-[hsl(var(--primary))]" /><div className="min-w-0 flex-1"><strong>{row.name}</strong><p className="text-xs text-[hsl(var(--muted-foreground))]">{row.description ?? row.reference}</p></div><Button variant="quiet" onClick={() => { setEditing(row); setFailure(''); }} testId={`button-edit-${kind}-${row.id}`}>Edit</Button></div>} />
    {editing && <RecordDialog key={`${kind}-${editing === 'new' ? 'new' : editing.id}`} title={`${editing === 'new' ? 'Add' : 'Edit'} ${kind.slice(0, -1)}`} fields={[{ key: 'name', label: 'Name', required: true }, { key: kind === 'categories' ? 'description' : 'reference', label: kind === 'categories' ? 'Description' : 'Reference' }, ...(kind === 'categories' && editing !== 'new' ? [{ key: 'isActive', label: 'Active', type: 'checkbox' as const }] : [])]} values={editing === 'new' ? {} : editing as unknown as Record<string, string | number | boolean | null>} onClose={() => setEditing(null)} pending={action.isPending} error={failure} onSave={async values => { try { await action.mutateAsync({ path: editing === 'new' ? kind : `${kind}/${editing?.id}`, method: editing === 'new' ? 'POST' : 'PATCH', data: toPayload(values, [], editing !== 'new') }); setEditing(null); setFailure(''); } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not save directory record.'); } }} />}
  </div>;
}

type Report = { catalogue: { catalogueTitles: number; totalCopies: number; availableCopies: number; borrowedCopies: number; lostCopies: number; damagedCopies: number }; loans: { activeLoans: number; overdueLoans: number; returnedLoans: number; lostLoans: number }; mostBorrowedBooks: { bookId: number; title: string; timesBorrowed: number }[]; borrowersWithOverdueItems: { borrowerUserId: number; overdueCount: number; oldestDueOn: string }[]; generatedAt: string };
function LibraryReports({ schoolId }: { schoolId: number }) {
  const query = usePhase9List<Report>('library/reports', schoolId);
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError || !query.data) return <ErrorState retry={() => void query.refetch()} />;
  const report = query.data;
  return <div><div className="eyebrow mb-3">Collection at a glance · {date(report.generatedAt)}</div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Titles" value={report.catalogue.catalogueTitles} icon={LibraryBig} detail={`${report.catalogue.totalCopies} physical copies`} accent /><Metric label="Available" value={report.catalogue.availableCopies} icon={BookCopy} /><Metric label="On loan" value={report.loans.activeLoans} icon={History} detail={`${report.loans.returnedLoans} returned historically`} /><Metric label="Overdue" value={report.loans.overdueLoans} icon={Clock3} detail={`${report.catalogue.lostCopies} lost · ${report.catalogue.damagedCopies} damaged`} /></div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="panel overflow-hidden"><WorkspaceIntro index="01 / Reader favourites" title="Most borrowed books" />{report.mostBorrowedBooks.length ? report.mostBorrowedBooks.map((book, index) => <div key={book.bookId} className="flex justify-between gap-4 border-b border-[hsl(var(--border))] p-4 text-sm last:border-0"><span><span className="mr-3 font-mono text-[hsl(var(--muted-foreground))]">{String(index + 1).padStart(2, '0')}</span>{book.title}</span><strong>{book.timesBorrowed}</strong></div>) : <EmptyState icon={ChartNoAxesColumn} title="No borrowing yet" description="Popular books will appear here as the collection is used." />}</section><section className="panel overflow-hidden"><WorkspaceIntro index="02 / Attention" title="Overdue borrowers" />{report.borrowersWithOverdueItems.length ? report.borrowersWithOverdueItems.map(row => <div key={row.borrowerUserId} className="flex justify-between gap-4 border-b border-[hsl(var(--border))] p-4 text-sm last:border-0"><span>User #{row.borrowerUserId} · oldest due {date(row.oldestDueOn)}</span><strong>{row.overdueCount}</strong></div>) : <EmptyState icon={Clock3} title="No overdue borrowers" description="There is nothing to follow up today." />}</section></div>
  </div>;
}

function LibrarySettings({ schoolId }: { schoolId: number }) {
  const query = usePhase9List<Settings>('library/settings', schoolId);
  const action = useLibraryAction(schoolId);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [revokeId, setRevokeId] = useState('');
  const [failure, setFailure] = useState('');
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError || !query.data) return <ErrorState retry={() => void query.refetch()} />;
  const settings = query.data;
  return <section className="panel max-w-4xl p-6 md:p-8"><Settings2 size={24} className="text-[hsl(var(--primary))]" /><div className="eyebrow mt-5">School-specific policy</div><h2 className="display-font mt-2 text-2xl font-bold">Borrowing rules</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Set loan periods and limits by reader type. Finance remains responsible for all payments; fines are not enabled here.</p><div className="mt-6 grid gap-3 sm:grid-cols-3">{(['Student', 'Teacher', 'Staff'] as const).map(type => <div key={type} className="rounded-xl bg-[hsl(var(--secondary)/.5)] p-4"><div className="eyebrow">{type} loans</div><strong className="mt-2 block">{settings[`${type.toLowerCase()}BorrowingEnabled`] ? 'Enabled' : 'Disabled'}</strong><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Up to {settings[`maxBooksPer${type}`]} books · {settings[`${type.toLowerCase()}LoanDays`]} days</p></div>)}</div><div className="mt-5 flex items-center justify-between border-t border-[hsl(var(--border))] pt-5"><p className="text-sm">Maximum {settings.maxRenewals} renewal{settings.maxRenewals === 1 ? '' : 's'} per loan</p><Button onClick={() => setEditing(true)}>Adjust rules</Button></div>
    {editing && <RecordDialog title="Borrowing rules" fields={settingsFields} values={settings} onClose={() => setEditing(false)} pending={action.isPending} error={failure} onSave={async values => { try { await action.mutateAsync({ path: 'settings', method: 'PATCH', data: toPayload(values, settingsFields.filter(field => field.type === 'number').map(field => field.key)) }); setEditing(false); setFailure(''); } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not save rules.'); } }} />}
    <div className="mt-8 border-t border-[hsl(var(--border))] pt-6"><div className="flex items-start gap-3"><UserRoundPlus size={20} className="text-[hsl(var(--primary))]" /><div><h3 className="font-bold">Library staff authorization</h3><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Assign an active school teacher or staff member to help run loans. Catalogue management is an additional permission.</p></div></div><div className="mt-5 flex flex-wrap gap-2"><Button variant="outline" onClick={() => setAssigning(true)}>Assign library staff</Button><input aria-label="User ID to revoke" data-testid="input-revoke-library-staff" type="number" min={1} className={`${phase9Input} max-w-44`} value={revokeId} onChange={event => setRevokeId(event.target.value)} placeholder="User ID to revoke" /><Button variant="danger" disabled={!Number(revokeId) || action.isPending} onClick={async () => { if (!window.confirm(`Revoke library access for user #${revokeId}?`)) return; try { await action.mutateAsync({ path: `staff/${revokeId}`, method: 'DELETE' }); setRevokeId(''); setFailure(''); } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not revoke access.'); } }}>Revoke access</Button></div>{failure && !editing && <p role="alert" className="mt-3 text-xs text-[hsl(var(--destructive))]">{failure}</p>}</div>
    {assigning && <RecordDialog title="Assign library staff" fields={[{ key: 'userId', label: 'School staff user ID', type: 'number', required: true, min: 1 }, { key: 'canManageCatalogue', label: 'Allow catalogue management', type: 'checkbox' }]} values={{ canManageCatalogue: false }} onClose={() => setAssigning(false)} pending={action.isPending} error={failure} onSave={async values => { try { await action.mutateAsync({ path: 'staff', data: toPayload(values, ['userId']) }); setAssigning(false); setFailure(''); } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not assign staff.'); } }} />}
  </section>;
}