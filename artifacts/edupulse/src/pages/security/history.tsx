import type { SecurityOperationHistory } from '@workspace/api-client-react';
import { Modal } from '@/components/shared';
import { fmtDateTime } from './security-contract';
import { QueryBoundary } from './ui';

export function HistoryModal({ title, query, onClose }: { title: string; query: { data?: SecurityOperationHistory[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }; onClose: () => void }) {
  return <Modal title={title} eyebrow="History" onClose={onClose}><QueryBoundary query={query}><ol className="space-y-3" data-testid="list-history">{(query.data ?? []).map(h => <li key={h.revision} className="rounded-xl border border-[hsl(var(--border))] p-3 text-sm"><div className="font-bold">r{h.revision} · {h.eventType.replaceAll('_', ' ')}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{h.result} · user #{h.actorUserId} · {fmtDateTime(h.createdAt)}</div></li>)}{!query.data?.length && <li className="text-sm text-[hsl(var(--muted-foreground))]">No history recorded.</li>}</ol></QueryBoundary></Modal>;
}
