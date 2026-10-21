import { useAuth } from '@clerk/react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus } from 'lucide-react';
import { customFetch, useGetAuthorizedContext, type NfcPaymentLink } from '@workspace/api-client-react';
import { Button, Modal, Field } from '@/components/shared';
import { safeStudentCheckoutUrl } from '@/pages/subscription-payment-helpers';

export type AssistedOptions = {
  students: { id: number; firstName: string; lastName: string; admissionNo: string; className: string; section: string;
    parents: { id: number; name: string; email: string | null; phone: string | null; relationshipType: string }[] }[];
  terms: { id: number; sessionId: number; name: string; sessionName: string; startDate: string; endDate: string; isCurrent: boolean }[];
  amountMinor: number;
};

export function canCreateAssistedNfcPayment(
  context: { isPlatformOwner?: boolean; roles?: { role: string; status: string; schoolId?: number | null }[] } | undefined,
  schoolId?: number,
) {
  if (!context || context.isPlatformOwner || !schoolId) return false;
  return (context.roles ?? []).some(r => r.role === 'SCHOOL_ADMIN' && r.status === 'ACTIVE' && r.schoolId === schoolId);
}

export const assistedOptionsKey = (identity: string, schoolId: number) => ['/api/student-nfc/assisted-options', identity, schoolId] as const;

export function AssistedNfcPayment({ schoolId, onCreated }: { schoolId?: number; onCreated?: () => void }) {
  const context = useGetAuthorizedContext().data;
  const { userId } = useAuth();
  const allowed = canCreateAssistedNfcPayment(context as never, schoolId);
  const [open, setOpen] = useState(false);
  if (!allowed || !userId || !schoolId) return null;
  return <>
    <Button onClick={() => setOpen(true)} testId="button-create-assisted-nfc">
      <Plus size={14} />Create NFC Payment
    </Button>
    {open && <Modal title="Create NFC Payment" eyebrow="School-assisted" onClose={() => setOpen(false)}>
      <AssistedForm schoolId={schoolId} identity={userId} onClose={() => setOpen(false)} onCreated={onCreated} />
    </Modal>}
  </>;
}

function AssistedForm({ schoolId, identity, onClose, onCreated }: { schoolId: number; identity: string; onClose: () => void; onCreated?: () => void }) {
  const qc = useQueryClient();
  const [studentId, setStudentId] = useState('');
  const [termId, setTermId] = useState('');
  const [link, setLink] = useState<NfcPaymentLink | null>(null);
  const options = useQuery({
    queryKey: assistedOptionsKey(identity, schoolId),
    queryFn: ({ signal }) => customFetch<AssistedOptions>(`/api/student-nfc/assisted-options?schoolId=${schoolId}`, { method: 'GET', signal }),
    refetchOnMount: 'always',
  });
  const create = useMutation({
    mutationFn: (body: { studentId: number; termId: number }) =>
      customFetch<NfcPaymentLink>(`/api/student-nfc/assisted-requests?schoolId=${schoolId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    onSuccess: res => {
      setLink(res);
      void qc.invalidateQueries({ queryKey: ['/api/student-nfc/obligations'] });
      onCreated?.();
    },
  });
  const data = options.data;
  const student = data?.students.find(s => String(s.id) === studentId);
  const term = data?.terms.find(t => String(t.id) === termId);
  const naira = (m: number) => `₦${(m / 100).toLocaleString('en-NG')}`;

  if (link) {
    const url = safeStudentCheckoutUrl(link.paymentUrl);
    return <div className="space-y-3 text-sm" data-testid="assisted-nfc-result">
      <p role="status" className="rounded-xl bg-[hsl(var(--secondary))] px-4 py-3 font-semibold">Payment request created. It is pending; nothing has been paid or verified.</p>
      <dl className="space-y-1 text-xs">
        <div>Student: <b>{link.studentName}</b> · {link.studentIdentifier} · {link.schoolName}</div>
        <div>Term: <b>{link.termName}, {link.sessionName}</b></div>
        <div>Status: <b>{String(link.status).replaceAll('_', ' ').toLowerCase()}</b> · Amount {naira(link.amountMinor)}</div>
        <div>Reference <span className="font-mono">{link.reference}</span></div>
        <div>Expires {new Date(link.expiresAt).toLocaleString()}</div>
      </dl>
      {url ? <a className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-semibold" href={url} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} />Open public payment link</a>
        : <p role="alert" className="text-xs text-[hsl(var(--destructive))]">The returned payment link was not a safe URL and was not opened.</p>}
      <div className="flex justify-end border-t border-[hsl(var(--border))] pt-4"><Button variant="outline" onClick={onClose}>Close</Button></div>
    </div>;
  }

  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (student && term) create.mutate({ studentId: student.id, termId: term.id }); }}>
    <p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">Flutterwave TEST ONLY. No live payments and no cash verification. The request stays pending until the server verifies a payment.</p>
    {options.isLoading ? <div className="skeleton h-24 rounded-xl" />
      : options.isError ? <p role="alert" className="text-sm text-[hsl(var(--destructive))]">Options could not be loaded. <button type="button" className="font-bold underline" onClick={() => void options.refetch()}>Retry</button></p>
      : !data?.students.length || !data.terms.length ? <p className="text-sm text-[hsl(var(--muted-foreground))]">{!data?.students.length ? 'No active students are available.' : 'No current or future term is available.'}</p>
      : <>
        <Field label="Student">
          <select required disabled={create.isPending} value={studentId} onChange={e => setStudentId(e.target.value)} data-testid="select-assisted-student">
            <option value="">Select a student</option>
            {data.students.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} · {s.admissionNo}</option>)}
          </select>
        </Field>
        {student && <div className="rounded-xl border border-[hsl(var(--border))] p-3 text-xs">
          <div>Class: <b>{student.className} {student.section}</b></div>
          <div className="mt-1">Parents: {student.parents.length ? student.parents.map(p => `${p.name}${p.relationshipType ? ` (${p.relationshipType.toLowerCase()})` : ''}${p.phone ? ` ${p.phone}` : ''}`).join('; ') : 'none linked'}</div>
        </div>}
        <Field label="Term (current or future)">
          <select required disabled={create.isPending} value={termId} onChange={e => setTermId(e.target.value)} data-testid="select-assisted-term">
            <option value="">Select a term</option>
            {data.terms.map(t => <option key={t.id} value={t.id}>{t.sessionName}, {t.name}{t.isCurrent ? ' (current)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Amount"><input readOnly value={naira(data.amountMinor)} aria-readonly="true" /></Field>
      </>}
    {create.isError && <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]">{create.error instanceof Error ? create.error.message : 'The request could not be created.'}</p>}
    <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button type="submit" disabled={create.isPending || !student || !term}>{create.isPending ? 'Creating…' : 'Create payment request'}</Button>
    </div>
  </form>;
}
