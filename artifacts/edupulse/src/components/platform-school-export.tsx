import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { phase9Request } from '@/hooks/use-phase9-api';
import { Button, ErrorState, SkeletonPage } from '@/components/shared';

type DirSchool = { id: number; name: string; code: string; status: string };
type Directory = { schools: DirSchool[]; totals?: Record<string, unknown> };

export function PlatformSchoolExport() {
  const dir = useQuery<Directory>({ queryKey: ['platform', 'schools-directory'], queryFn: () => phase9Request<Directory>('/platform/schools/directory'), staleTime: 15_000 });
  const [selected, setSelected] = useState<number[]>([]);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const toggle = (id: number) => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : p.length >= 50 ? p : [...p, id]);
  const run = async () => {
    if (busy.current || selected.length < 1 || selected.length > 50) return;
    busy.current = true; setPhase('working'); setMessage('Preparing the CSV...');
    try {
      const res = await fetch('/api/platform/exports/schools', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schoolIds: selected }) });
      if (!res.ok) { const j = await res.json().catch(() => null) as { error?: string } | null; throw new Error(j?.error ?? `Export failed (${res.status}).`); }
      if (!(res.headers.get('content-type') ?? '').toLowerCase().includes('text/csv')) throw new Error('The server did not return a CSV file.');
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('The export file was empty.');
      const match = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = match?.[1] ?? 'school-directory.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setPhase('done'); setMessage(`Download started for ${selected.length} school${selected.length === 1 ? '' : 's'}.`);
    } catch (e) { setPhase('error'); setMessage(e instanceof Error ? e.message : 'Export failed.'); }
    finally { busy.current = false; }
  };
  if (dir.isLoading) return <SkeletonPage />;
  if (dir.isError || !dir.data) return <ErrorState retry={() => void dir.refetch()} />;
  return <div className="panel p-6 md:p-8" data-testid="panel-school-export">
    <div className="flex items-center gap-3 mb-3"><Download size={22} className="text-[hsl(var(--primary))]" /><h2 className="display-font text-2xl font-bold">School directory export</h2></div>
    <p className="text-sm text-[hsl(var(--muted-foreground))]">Exports a privacy-limited CSV of school directory details for the schools you choose. This is not a full database backup and contains no student, parent or finance records.</p>
    <div className="mt-5 flex items-center justify-between text-xs font-bold"><span data-testid="text-export-count">{selected.length} of 50 selected</span><button type="button" className="text-[hsl(var(--primary))]" onClick={() => setSelected([])}>Clear</button></div>
    <div className="mt-2 max-h-72 divide-y divide-[hsl(var(--border))] overflow-y-auto rounded-xl border border-[hsl(var(--border))]">
      {dir.data.schools.map(s => <label key={s.id} className="flex items-center gap-3 p-3 text-sm"><input type="checkbox" data-testid={`checkbox-export-school-${s.id}`} checked={selected.includes(s.id)} disabled={phase === 'working' || (!selected.includes(s.id) && selected.length >= 50)} onChange={() => toggle(s.id)} /><span className="flex-1 font-semibold">{s.name}</span><span className="text-xs text-[hsl(var(--muted-foreground))]">{s.code} · {s.status.toLowerCase()}</span></label>)}
      {!dir.data.schools.length && <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">No schools on the platform yet.</p>}
    </div>
    <Button className="mt-5" testId="button-export-schools" disabled={selected.length < 1 || phase === 'working'} onClick={() => void run()}><Download size={16} />{phase === 'working' ? 'Exporting...' : 'Download CSV'}</Button>
    {message && <p role={phase === 'error' ? 'alert' : 'status'} data-testid="text-export-status" className={`mt-3 text-sm ${phase === 'error' ? 'text-[hsl(var(--destructive))]' : ''}`}>{message}</p>}
  </div>;
}
