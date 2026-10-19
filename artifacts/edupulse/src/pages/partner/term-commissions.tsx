import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPartnerTermCommissions, useListPartnerPayoutBatches, useApprovePartnerPayoutBatch,
  getPartnerPayoutBatchExport, getListPartnerTermCommissionsQueryKey, getListPartnerPayoutBatchesQueryKey,
} from '@workspace/api-client-react';
import { PageHeading, Button, SkeletonPage, ErrorState, EmptyState, Modal, StatusPill, date } from '@/components/shared';
import { useToast } from '@/hooks/use-toast';
import { HandCoins, Download, RefreshCw } from 'lucide-react';
import {
  groupCommissions, isEligible, currentLiability, formatMinor, formatSum, prepareApproval, readApprovalDraft, clearApprovalDraft,
  isAmbiguousFailure, type ApprovalDraft,
} from '@/lib/partner-term-commissions';

const Cell = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-[8rem]"><div className="eyebrow">{label}</div><div className="mt-0.5 text-sm font-bold">{value}</div></div>
);

export default function TermCommissionsPage() {
  const rowsQ = useListPartnerTermCommissions({query:{queryKey:getListPartnerTermCommissionsQueryKey(),staleTime:0,refetchInterval:30000}});
  const batchesQ = useListPartnerPayoutBatches({query:{queryKey:getListPartnerPayoutBatchesQueryKey(),staleTime:0,refetchInterval:30000}});
  const approve = useApprovePartnerPayoutBatch();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<ApprovalDraft | null>(() => readApprovalDraft(window.sessionStorage));
  const [exportingId, setExportingId] = useState<number | null>(null);

  const rows = rowsQ.data ?? [];
  const groups = useMemo(() => groupCommissions(rows), [rows]);
  const locked = draft !== null;
  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);
  const chosenIds = locked ? draft!.commissionIds : [...selected].sort((a, b) => a - b);
  const chosenTotal = chosenIds.reduce((a, id) => a + (byId.get(id)?.amountMinor ?? 0), 0);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListPartnerTermCommissionsQueryKey() }),
      qc.invalidateQueries({ queryKey: getListPartnerPayoutBatchesQueryKey() }),
    ]);
  };

  const toggle = (ids: number[], on: boolean) => setSelected(cur => {
    const n = new Set(cur); ids.forEach(i => (on ? n.add(i) : n.delete(i))); return n;
  });

  const submit = async () => {
    if (chosenIds.length === 0) return;
    const d = prepareApproval(window.sessionStorage, chosenIds);
    setDraft(d);
    try {
      const batch=await approve.mutateAsync({ data: { commissionIds: d.commissionIds, idempotencyKey: d.idempotencyKey } });
      clearApprovalDraft(window.sessionStorage);
      setDraft(null); setSelected(new Set()); setConfirming(false);
      toast(batch.status==='REVIEW_REQUIRED'
        ? {title:'Batch needs review',description:'The original approval was found but has since been invalidated. Do not execute an earlier export.',variant:'destructive'}
        : { title: 'Approval recorded', description: 'Batch recorded for export. No money was sent.' });
      await refresh();
    } catch (e) {
      setConfirming(false);
      if (isAmbiguousFailure(e)) {
        toast({ title: 'Approval outcome unknown', description: 'The same request is retained. Retry it or reconcile against batch history.', variant: 'destructive' });
      } else {
        clearApprovalDraft(window.sessionStorage); setDraft(null);
        toast({ title: 'Approval rejected', description: (e as { error?: string; message?: string })?.error ?? (e as Error)?.message ?? 'The server rejected this approval.', variant: 'destructive' });
        await refresh();
      }
    }
  };

  const exportBatch = async (id: number) => {
    setExportingId(id);
    try {
      const data = await getPartnerPayoutBatchExport(id);
      if (String(data.status).toUpperCase() !== 'APPROVED') {
        toast({ title: 'Export blocked', description: 'This batch has been revoked.', variant: 'destructive' });
        await refresh();
        return;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `partner-payout-batch-${id}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: 'Export failed', description: (e as Error)?.message ?? 'Could not export.', variant: 'destructive' });
    } finally { setExportingId(null); }
  };

  if (rowsQ.isLoading) return <SkeletonPage />;
  if (rowsQ.isError) return <ErrorState retry={() => rowsQ.refetch()} />;

  return (
    <div className="w-full min-w-0 animate-in fade-in slide-in-from-bottom-4 duration-500" data-testid="page-term-commissions">
      <PageHeading eyebrow="Ecosystem" title="Term Commissions"
        description="Review deferred Partner commissions by session, term and Partner, then approve eligible rows." />
      <div className="mb-6 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4 text-sm" role="status" data-testid="notice-record-only">
        Approval is recording and export only. It creates an audit batch you can export; it never sends money to a Partner.
        Only rows that are eligible, in an ended term, and PENDING can be selected. Additional fee is shown separately and is not VAT.
        Merchant remainder and Owner net are calculated from reported costs, not proof of merchant bank settlement.
        Refunded, reversed or held entries are excluded from payable approval; recorded original amounts remain visible for audit.
      </div>

      {locked && (
        <div className="mb-6 rounded-xl border border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--destructive)/.06)] p-4 text-sm" role="alert" data-testid="banner-retry">
          <div className="font-bold">An approval request is awaiting confirmation</div>
          <p className="mt-1">{draft!.commissionIds.length} commission(s) were submitted and the outcome is unknown. Selection is locked. Retry sends the identical request and key; the server will not apply it twice.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button testId="button-retry-approval" onClick={() => void submit()} disabled={approve.isPending}><RefreshCw size={14} />{approve.isPending ? 'Retrying…' : 'Retry same request'}</Button>
            <Button variant="outline" testId="button-reconcile" onClick={() => void refresh()}>Reconcile (refresh)</Button>
            <Button variant="outline" testId="button-discard-request" onClick={() => { clearApprovalDraft(window.sessionStorage); setDraft(null); }}>Discard after checking history</Button>
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="panel"><EmptyState icon={HandCoins} title="No term commissions" description="Deferred commissions appear here once Partner-attributed payments are recorded." /></div>
      ) : (
        <div className="space-y-5">
          {groups.map(g => {
            const eligibleIds = g.rows.filter(isEligible).map(r => r.id);
            const allOn = eligibleIds.length > 0 && eligibleIds.every(i => selected.has(i));
            return (
              <section key={g.key} className="panel overflow-hidden" data-testid={`group-${g.key}`}>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[hsl(var(--border))] p-5">
                  <div>
                    <div className="eyebrow">{g.sessionName} · {g.term}</div>
                    <h2 className="display-font mt-1 text-xl font-bold">{g.partnerName}</h2>
                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Schools {g.schoolIds.join(', ')} · school term ids {g.termIds.join(', ')}</div>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" className="!w-4" disabled={locked || eligibleIds.length === 0} checked={allOn}
                      onChange={e => toggle(eligibleIds, e.target.checked)} data-testid={`select-group-${g.key}`} />
                    Select all eligible ({eligibleIds.length})
                  </label>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] p-5">
                  <Cell label="Gross" value={formatMinor(g.gross)} />
                  <Cell label="School share" value={formatMinor(g.school)} />
                  <Cell label="Provider fee" value={formatSum(g.providerFee)} />
                  <Cell label="Additional fee (not VAT)" value={formatSum(g.additionalFee)} />
                  <Cell label="VAT" value={formatSum(g.vat)} />
                  <Cell label="Merchant remainder" value={formatSum(g.remainder)} />
                  <Cell label="Owner net" value={formatSum(g.ownerNet)} />
                  <Cell label="Partner liability" value={formatMinor(g.partner)} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-left text-sm">
                    <thead className="font-bold text-[hsl(var(--muted-foreground))]"><tr>
                      <th className="p-3 w-10"><span className="sr-only">Select</span></th><th className="p-3">Reference</th><th className="p-3">School / term id</th>
                      <th className="p-3">Gross</th><th className="p-3">School</th><th className="p-3">Provider fee</th><th className="p-3">Additional fee</th>
                      <th className="p-3">VAT</th><th className="p-3">Remainder</th><th className="p-3">Owner net</th><th className="p-3">Partner liability</th><th className="p-3">Status</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[hsl(var(--border))]">
                      {g.rows.map(r => {
                        const ok = isEligible(r);
                        return (
                          <tr key={r.id} data-testid={`row-commission-${r.id}`}>
                            <td className="p-3"><input type="checkbox" className="!w-4" disabled={!ok || locked} checked={locked ? draft!.commissionIds.includes(r.id) : selected.has(r.id)}
                              onChange={e => toggle([r.id], e.target.checked)} aria-label={`Select commission ${r.reference}`} data-testid={`select-commission-${r.id}`} /></td>
                            <td className="p-3 font-mono text-xs">{r.reference}</td>
                            <td className="p-3 text-xs">{r.schoolId} / {r.termId}</td>
                            <td className="p-3">{formatMinor(r.grossMinor)}</td>
                            <td className="p-3">{formatMinor(r.schoolMinor)}</td>
                            <td className="p-3">{formatMinor(r.providerFeeMinor)}</td>
                            <td className="p-3">{formatMinor(r.providerAdditionalFeeMinor)}</td>
                            <td className="p-3">{formatMinor(r.vatMinor)}</td>
                            <td className="p-3">{formatMinor(r.merchantRemainderMinor)}</td>
                            <td className="p-3">{formatMinor(r.ownerNetMinor)}</td>
                            <td className="p-3 font-bold">{formatMinor(currentLiability(r))}
                              {currentLiability(r)===0 && <div className="text-xs font-normal">Original: {formatMinor(r.amountMinor)}</div>}</td>
                            <td className="p-3"><StatusPill value={r.status} />
                              {!ok && <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{r.status !== 'PENDING' ? 'Already actioned' : !r.termEnded ? 'Term not ended' : 'Not eligible'}</div>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="sticky bottom-4 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-lg" data-testid="bar-selection">
        <div className="text-sm"><strong data-testid="text-selected-count">{chosenIds.length}</strong> selected · Partner liability <strong>{formatMinor(chosenTotal)}</strong></div>
        <Button disabled={chosenIds.length === 0 || approve.isPending || locked} onClick={() => setConfirming(true)} testId="button-approve-selected">Approve for recording and export</Button>
      </div>

      {confirming && (
        <Modal title="Confirm approval" eyebrow="Recording and export only" onClose={() => setConfirming(false)}>
          <div className="space-y-4 text-sm">
            <p>You are approving {chosenIds.length} commission(s) totalling {formatMinor(chosenTotal)} in one batch. This records an immutable audit batch for export. It does not send money.</p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setConfirming(false)} testId="button-cancel-approval">Cancel</Button>
              <Button onClick={() => void submit()} disabled={approve.isPending} testId="button-confirm-approval">{approve.isPending ? 'Recording…' : 'Confirm approval'}</Button>
            </div>
          </div>
        </Modal>
      )}

      <section className="panel mt-8 overflow-hidden" data-testid="section-batch-history">
        <div className="border-b border-[hsl(var(--border))] p-5">
          <div className="eyebrow">Immutable audit</div>
          <h2 className="display-font mt-1 text-xl font-bold">Approval batch history</h2>
        </div>
        {batchesQ.isLoading ? <div className="p-5"><div className="skeleton h-12 rounded-xl" /></div>
          : batchesQ.isError ? <div className="p-5 text-sm">Batch history failed to load. <Button variant="outline" className="ml-2 h-8 px-3 text-xs" onClick={() => batchesQ.refetch()}>Retry</Button></div>
          : (batchesQ.data ?? []).length === 0 ? <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">No batches approved yet.</div>
          : <div className="divide-y divide-[hsl(var(--border))]">
            {batchesQ.data!.map(b => {
              const revoked = String(b.status).toUpperCase() !== 'APPROVED';
              return (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm" data-testid={`batch-${b.id}`}>
                  <div>
                    <div className="font-bold">Batch #{b.id} · {b.currency} {(b.amountMinor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">{date(b.approvedAt)} · approved by user {b.approvedBy} · {b.items.length} item(s) · mode {b.executionMode}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill value={b.status} />
                    <Button variant="outline" className="h-8 px-3 text-xs" disabled={revoked || exportingId === b.id} onClick={() => void exportBatch(b.id)} testId={`button-export-${b.id}`}>
                      <Download size={13} />{revoked ? 'Export blocked' : exportingId === b.id ? 'Exporting…' : 'Export JSON'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>}
      </section>
    </div>
  );
}
