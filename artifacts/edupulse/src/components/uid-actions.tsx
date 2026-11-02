import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  customFetch, useListSchools, useListStudents, getListCardsQueryKey, getListStudentsQueryKey, getListCardReplacementsQueryKey,
} from '@workspace/api-client-react';
import { Button, Field, Modal } from '@/components/shared';
import { uidInventoryKey } from '@/components/owner-uid-reader';

const errCls = 'text-sm font-medium text-[hsl(var(--destructive))]';
export const backendError = (e: unknown) => {
  const x = e as any;
  return x?.data?.error ?? x?.data?.message ?? x?.response?.data?.error ?? (e instanceof Error ? e.message : 'The request failed.');
};
const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function useInvalidateCardData() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: uidInventoryKey }),
    qc.invalidateQueries({ queryKey: getListCardsQueryKey() }),
    qc.invalidateQueries({ queryKey: getListStudentsQueryKey() }),
    qc.invalidateQueries({ queryKey: getListCardReplacementsQueryKey() }),
  ]);
}

export function AssignUidModal({ uid, onClose }: { uid: string; onClose: () => void }) {
  const qc=useQueryClient();
  const invalidate = useInvalidateCardData();
  const [schoolId, setSchoolId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [ok, setOk] = useState(false);
  const schools = useListSchools({ status: 'active' as any });
  const students = useListStudents({ schoolId: Number(schoolId), status: 'all' as any } as any, { query: { enabled: !!schoolId, queryKey: getListStudentsQueryKey({ schoolId: Number(schoolId), status: 'all' } as any) } });
  const m = useMutation({
    mutationFn: () => customFetch<{schoolId:number;studentId:number;status:string}>('/api/platform/uid-inventory/assign', json({ uid, schoolId: Number(schoolId), studentId: Number(studentId), confirm: true })),
    onSuccess: async result => {
      qc.setQueryData(uidInventoryKey,(old:any)=>old?{...old,inventory:old.inventory.map((row:any)=>row.uid===uid?{...row,assigned:true,schoolId:result.schoolId,studentId:result.studentId,status:result.status}:row)}:old);
      onClose(); await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: [...uidInventoryKey, 'scans'] })]);
    },
  });
  const schoolList = ((schools.data ?? []) as any[]);
  const studentList = ((students.data ?? []) as any[]);
  return (
    <Modal title="Assign UID to student" eyebrow="UID inventory" onClose={onClose}>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); m.mutate(); }} data-testid="form-assign-uid">
        <Field label="Captured UID (read-only)"><input readOnly value={uid} className="font-mono" data-testid="input-assign-uid" /></Field>
        <Field label="School">
          <select value={schoolId} onChange={e => { setSchoolId(e.target.value); setStudentId(''); }} data-testid="select-assign-school">
            <option value="">{schools.isLoading ? 'Loading schools...' : 'Select a school'}</option>
            {schoolList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Student">
          <select value={studentId} onChange={e => setStudentId(e.target.value)} disabled={!schoolId} data-testid="select-assign-student">
            <option value="">{students.isLoading && schoolId ? 'Loading students...' : 'Select a student'}</option>
            {studentList.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}{s.admissionNo ? ` · ${s.admissionNo}` : ''}</option>)}
          </select>
        </Field>
        <p className="text-sm">This binds the permanent UID <strong className="font-mono">{uid}</strong> to the selected student.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="!w-auto" checked={ok} onChange={e => setOk(e.target.checked)} data-testid="checkbox-assign-confirm" />I confirm this assignment.</label>
        {m.isError && <p role="alert" className={errCls} data-testid="text-assign-error">{backendError(m.error)}</p>}
        <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" testId="button-assign-submit" disabled={m.isPending || !ok || !schoolId || !studentId}>{m.isPending ? 'Assigning...' : 'Assign to student'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function OwnerUnlinkCard({ cards }: { cards: any[] }) {
  const invalidate = useInvalidateCardData();
  const [cardId, setCardId] = useState('');
  const [kind, setKind] = useState<'LOST' | 'DAMAGED'>('LOST');
  const [reason, setReason] = useState('');
  const [ok, setOk] = useState(false);
  const [msg, setMsg] = useState('');
  const m = useMutation({
    mutationFn: () => customFetch<{ requiresSchoolAdminRequest?: boolean }>(`/api/platform/uid-inventory/cards/${cardId}/unlink`, json({ kind, reason: reason.trim(), confirm: true })),
    onSuccess: async r => {
      setMsg(r?.requiresSchoolAdminRequest ? 'Card revoked. This is an employee card: the School Admin must file the replacement request and payment.' : 'Card revoked immediately. A replacement request has been raised under the existing payment rules.');
      setCardId(''); setReason(''); setOk(false);
      await invalidate();
    },
  });
  return (
    <div className="panel mb-6 p-5" data-testid="panel-owner-unlink">
      <h2 className="display-font text-lg font-bold">Unlink lost or damaged card</h2>
      <p className="mb-3 text-sm text-[hsl(var(--muted-foreground))]">Revokes the card at once. The student replacement request and invoice follow the existing payment rules.</p>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={e => { e.preventDefault(); setMsg(''); m.mutate(); }}>
        <Field label="Card"><select value={cardId} onChange={e => setCardId(e.target.value)} data-testid="select-unlink-card"><option value="">{cards.length ? 'Select a card' : 'No cards available'}</option>{cards.map(c => <option key={c.id} value={c.id}>{c.studentName ?? `Card #${c.id}`} · {c.status}{c.uid ? ` · ${c.uid}` : ''}</option>)}</select></Field>
        <Field label="Kind"><select value={kind} onChange={e => setKind(e.target.value as any)} data-testid="select-unlink-kind"><option value="LOST">Lost</option><option value="DAMAGED">Damaged</option></select></Field>
        <div className="md:col-span-2"><Field label="Reason (min 3 characters)"><input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} data-testid="input-unlink-reason" /></Field></div>
        <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" className="!w-auto" checked={ok} onChange={e => setOk(e.target.checked)} data-testid="checkbox-unlink-confirm" />I confirm this card is {kind === 'LOST' ? 'lost' : 'damaged'} and must be revoked now.</label>
        {m.isError && <p role="alert" className={`${errCls} md:col-span-2`} data-testid="text-unlink-error">{backendError(m.error)}</p>}
        {msg && <p role="status" className="text-sm font-semibold text-emerald-600 md:col-span-2" data-testid="text-unlink-success">{msg}</p>}
        <div className="md:col-span-2"><Button type="submit" variant="danger" testId="button-unlink-submit" disabled={!cardId || reason.trim().length < 3 || !ok || m.isPending}>{m.isPending ? 'Unlinking...' : 'Unlink card'}</Button></div>
      </form>
    </div>
  );
}
