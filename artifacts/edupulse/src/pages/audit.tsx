import { useState } from 'react';
import { FileClock, Activity } from 'lucide-react';
import { useListAuditLogs } from '@workspace/api-client-react';
import { 
  PageHeading, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  TenantPicker, useTenant, date, time, cx
} from '@/components/shared';

export function AuditPage() {
  const { schoolId, setSchoolId } = useTenant();
  
  // Note: we fetch audit logs using listAuditLogs, optionally filtered by schoolId
  const query = useListAuditLogs({ schoolId: schoolId || undefined }); 
  const logs: any[] = query.data ?? [];
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Security / Audit Log" 
        title="Immutable Operations Trail." 
        description="Every structural change, financial move, and security event is recorded permanently." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
          </div>
        } 
      />
      
      {query.isLoading ? (
        <SkeletonPage />
      ) : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : (
        <div className="panel overflow-hidden">
          <div className="hidden grid-cols-[2fr_1fr_1fr_1.5fr] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
            <span>Action</span>
            <span>Module</span>
            <span>User</span>
            <span>Timestamp</span>
          </div>
          {logs.length ? logs.map((log: any) => (
            <div key={log.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-4 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[2fr_1fr_1fr_1.5fr] md:items-center md:gap-4 md:px-6">
              <div className="flex items-start gap-3">
                <div className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl', log.severity === 'critical' ? 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]' : 'bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))] dark:bg-[hsl(var(--accent)/.15)] dark:text-[hsl(var(--accent))]')}>
                  <Activity size={14} />
                </div>
                <div>
                  <div className="font-bold text-sm text-[hsl(var(--foreground))]">{log.action}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    {log.severity && <StatusPill value={log.severity} />}
                    {log.school && <span className="text-[hsl(var(--muted-foreground))]">in {log.school}</span>}
                  </div>
                </div>
              </div>
              <div className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{log.module}</div>
              <div className="text-sm font-medium">{log.user}</div>
              <div className="text-sm font-mono text-[hsl(var(--muted-foreground))]">
                {date(log.timestamp)} {time(log.timestamp)}
              </div>
            </div>
          )) : (
            <EmptyState icon={FileClock} title="No activity recorded" description="No actions match the current filter criteria." />
          )}
        </div>
      )}
    </div>
  );
}