import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { FileUp, Download, Lock } from 'lucide-react';
import { Button } from '@/components/shared';

export type ReceiptKind = 'PARENT_BANK_TRANSFER' | 'SCHOOL_SETTLEMENT';
export type UploadedReceipt = { id: string; canonicalReceiptId?:string; sha256: string; downloadPath: string; uploadedAt: string };
export type ReceiptMeta = {
  kind: ReceiptKind; invoiceId?: number; orderReference?: string; amountMinor: number;
  purpose: string; transferDate: string; transferCompleted?: true;
};

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const note = 'text-xs leading-5 text-[hsl(var(--muted-foreground))]';

export function validateReceiptFile(file: File | null): string | null {
  if (!file) return 'Choose a receipt file.';
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) return 'Receipt must be a JPEG, PNG or PDF file.';
  if (file.size < 1) return 'The selected file is empty.';
  if (file.size > RECEIPT_MAX_BYTES) return 'Receipt must be 5 MiB or smaller.';
  return null;
}

/** Returns the receipt id only if the path is an exact private internal receipt download path. */
export function internalReceiptId(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const re = new RegExp(`^/api/payment-receipts/(${UUID})/download$`, 'i');
  const candidates = [path];
  if (base && path.startsWith(`${base}/api/`)) candidates.push(path.slice(base.length));
  for (const candidate of candidates) {
    const match = re.exec(candidate);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

export function isReceiptSubmissionReference(ref: string | null | undefined) {
  return !!ref && new RegExp(`^RECEIPT_${UUID}$`, 'i').test(ref);
}

/** Two-step private upload: create metadata record, then PUT the raw file bytes. No base64. */
export async function uploadPrivateReceipt(meta: ReceiptMeta, file: File): Promise<UploadedReceipt> {
  const invalid = validateReceiptFile(file);
  if (invalid) throw new Error(invalid);
  const created = await customFetch<{ id: string; uploadPath: string }>('/api/payment-receipts', {
    method: 'POST', body: JSON.stringify(meta), headers: { 'content-type': 'application/json' }, responseType: 'json',
  });
  if (!created?.uploadPath || !created.uploadPath.startsWith('/api/payment-receipts/')) {
    throw new Error('The server returned an unexpected upload location. Nothing was uploaded.');
  }
  const uploaded = await customFetch<UploadedReceipt>(created.uploadPath, {
    method: 'PUT', body: file, headers: { 'content-type': file.type }, responseType: 'json',
  });
  if (uploaded.id !== created.id || !/^[a-f0-9]{64}$/i.test(uploaded.sha256)) {
    throw new Error('The upload response did not match the receipt record.');
  }
  if (uploaded.canonicalReceiptId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uploaded.canonicalReceiptId)) {
    throw new Error('The server returned an invalid receipt identity.');
  }
  return {...uploaded,id:uploaded.canonicalReceiptId??uploaded.id};
}

export async function downloadPrivateReceipt(id: string, filename = `receipt-${id}`) {
  const blob = await customFetch<Blob>(`/api/payment-receipts/${encodeURIComponent(id)}/download`, { method: 'GET', responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ReceiptDownloadButton({ id, label = 'Download private receipt', testId }: { id: string; label?: string; testId?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <span className="inline-flex flex-col">
      <Button variant="outline" disabled={busy} testId={testId ?? `button-download-receipt-${id}`} onClick={() => {
        setBusy(true); setError('');
        downloadPrivateReceipt(id).catch(e => setError(e instanceof Error ? e.message : 'Download failed.')).finally(() => setBusy(false));
      }}><Download size={14} />{busy ? 'Downloading...' : label}</Button>
      {error && <span role="alert" className="mt-1 text-xs text-[hsl(var(--destructive))]">{error}</span>}
    </span>
  );
}

/** File picker only; the parent form decides when to call uploadPrivateReceipt. */
export function ReceiptFilePicker({ file, onChange, disabled, testId = 'input-receipt-file', label = 'Receipt file' }: {
  file: File | null; onChange: (file: File | null) => void; disabled?: boolean; testId?: string; label?: string;
}) {
  const error = file ? validateReceiptFile(file) : null;
  return (
    <label className="block text-sm">
      <span className="font-semibold">{label}</span>
      <span className="mt-1 flex items-center gap-2 rounded-lg border border-dashed border-[hsl(var(--border))] px-3 py-2">
        <FileUp size={16} className="shrink-0 text-[hsl(var(--primary))]" />
        <input type="file" accept="image/jpeg,image/png,application/pdf" disabled={disabled} className="min-w-0 flex-1 text-xs"
          onChange={e => onChange(e.target.files?.[0] ?? null)} data-testid={testId} />
      </span>
      <span className={`mt-1 flex items-center gap-1 ${note}`}><Lock size={12} />Stored privately. JPEG, PNG or PDF up to 5 MiB.{file && !error ? ` Selected: ${file.name}` : ''}</span>
      {error && <span role="alert" className="mt-1 block text-xs text-[hsl(var(--destructive))]">{error}</span>}
    </label>
  );
}
