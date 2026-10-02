import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadCurriculumSourceDocument } from '@workspace/api-client-react';
import { Button } from '@/components/shared';
import { Notice, errMsg } from '@/components/school-ops-kit';

/** Authenticated blob download via the generated client (customFetch attaches the bearer token). */
export function SourceDownload({ importId, filename, testId = 'button-download-source' }: { importId: number; filename?: string; testId?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try {
      const blob = await downloadCurriculumSourceDocument(importId, { responseType: 'blob' });
      if (!(blob instanceof Blob)) throw new Error('The server did not return a file.');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename ?? `curriculum-source-${importId}`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(errMsg(e, 'The source document could not be downloaded.')); }
    setBusy(false);
  };
  return (<div><Button variant="outline" disabled={busy} onClick={run} testId={testId}><Download size={14} />{busy ? 'Downloading' : 'Download source document'}</Button>{error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}</div>);
}
