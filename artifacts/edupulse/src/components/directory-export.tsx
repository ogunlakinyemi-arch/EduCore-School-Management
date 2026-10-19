import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useGetAuthorizedContext } from '@workspace/api-client-react';
import { Button, useTenant } from '@/components/shared';

type Kind = 'students' | 'classes' | 'parents' | 'staff' | 'teachers';

export function DirectoryExport({ kind }: { kind: Kind }) {
  const { schoolId } = useTenant();
  const auth = useGetAuthorizedContext();
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const permitted = auth.data?.isPlatformOwner || auth.data?.roles.some(
    role => role.role === 'SCHOOL_ADMIN' && role.status === 'ACTIVE' && role.schoolId === schoolId,
  );
  if (!permitted) return null;

  async function download() {
    if (!schoolId || busy.current) return;
    busy.current = true;
    setWorking(true);
    setMessage('');
    const selectedSchool = schoolId;
    try {
      const offset = (page - 1) * 200;
      const query = new URLSearchParams({ schoolId: String(selectedSchool), format: 'xlsx', limit: '200', offset: String(offset) });
      const res = await fetch(`/api/reports/directory-${kind}/export?${query}`, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Export failed (${res.status})`);
      }
      if (!res.headers.get('content-type')?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
        throw new Error('The server did not return an Excel file.');
      }
      const blob = await res.blob();
      if (!blob.size) throw new Error('The export file was empty.');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `school-${selectedSchool}-${kind}-page-${page}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const total = Number(res.headers.get('X-Report-Total'));
      const rows = Number(res.headers.get('X-Report-Rows'));
      setMessage(`School ${selectedSchool}: downloaded ${rows} of ${total} records (page ${page} of ${Math.max(1, Math.ceil(total / 200))}).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return <div className="flex flex-wrap items-center gap-2 text-xs">
    <label>Export page
      <input aria-label={`${kind} export page`} type="number" min={1} max={5001}
        className="ml-2 w-20" value={page} disabled={working}
        onChange={e => setPage(Math.min(5001, Math.max(1, Math.floor(Number(e.target.value)) || 1)))} />
    </label>
    <Button variant="quiet" disabled={!schoolId || working} onClick={download}>
      <Download size={15} />{working ? 'Exporting…' : `Excel: ${kind}`}
    </Button>
    <span>All statuses, no search filter; up to 200 records per file.</span>
    <span role="status">{message}</span>
  </div>;
}
