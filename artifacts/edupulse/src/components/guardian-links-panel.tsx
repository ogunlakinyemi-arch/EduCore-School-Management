import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  deactivateParentStudentRelationship,
  getListParentStudentRelationshipsQueryKey,
  getListParentsQueryKey,
  getListStudentsQueryKey,
  useListParentStudentRelationships,
} from '@workspace/api-client-react';
import type { ParentStudentRelationship } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Button } from '@/components/shared';

type GuardianLink = ParentStudentRelationship & {
  parentName?: string;
  studentName?: string;
};

export function GuardianLinksPanel({
  schoolId,
  studentId,
  parentId,
}: {
  schoolId: number;
  studentId?: number;
  parentId?: number;
}) {
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const query = useListParentStudentRelationships(
    { schoolId },
    { query: { enabled: !!schoolId, queryKey: getListParentStudentRelationshipsQueryKey({ schoolId }) } },
  );
  const rows = ((query.data ?? []) as GuardianLink[]).filter(link =>
    link.status === 'ACTIVE' &&
    (studentId !== undefined ? link.studentId === studentId : link.parentId === parentId),
  );

  const unlink = async (link: GuardianLink) => {
    const parentName = link.parentName || 'this parent/guardian';
    const studentName = link.studentName || 'this student';
    if (!window.confirm(
      `Unlink ${parentName} from ${studentName}? This only deactivates the relationship; it does not delete either record or historical data.`,
    )) return;
    setPendingId(link.id);
    setError('');
    setNotice('');
    try {
      await deactivateParentStudentRelationship(link.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListParentStudentRelationshipsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListParentsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListStudentsQueryKey() }),
      ]);
      setNotice(`Unlinked ${parentName} from ${studentName}. Their records and history are unchanged.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not unlink this relationship. Try again.');
    } finally {
      setPendingId(null);
    }
  };

  if (query.isLoading) return <p role="status" className="text-sm text-[hsl(var(--muted-foreground))]">Loading guardian links…</p>;
  if (query.isError) return <div className="space-y-3">
    <p role="alert" className="text-sm text-[hsl(var(--destructive))]">Guardian links could not be loaded.</p>
    <Button type="button" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
  </div>;

  return <div className="space-y-4">
    <p className="text-sm text-[hsl(var(--muted-foreground))]">
      Unlinking removes this guardian’s access through this relationship. Student and parent records, their accounts, and history are retained.
    </p>
    {notice && <p role="status" className="text-sm text-[hsl(var(--primary))]">{notice}</p>}
    {error && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
    {rows.length ? <ul className="space-y-2">
      {rows.map(link => <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] p-3">
        <div className="min-w-0">
          <div className="font-semibold">{studentId !== undefined ? link.parentName || `Parent/guardian #${link.parentId}` : link.studentName || `Student #${link.studentId}`}</div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">{link.relationshipType}</div>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={pendingId !== null}
          onClick={() => void unlink(link)}
          testId={`button-unlink-relationship-${link.id}`}
        >
          {pendingId === link.id ? 'Unlinking…' : 'Unlink'}
        </Button>
      </li>)}
    </ul> : <p className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--muted-foreground))]">
      No active guardian links are recorded here.
    </p>}
    {studentId !== undefined && <p className="text-sm">
      To connect a different guardian, use the <Link className="font-semibold underline" href="/parents">Parents &amp; Guardians page</Link>.
    </p>}
  </div>;
}
