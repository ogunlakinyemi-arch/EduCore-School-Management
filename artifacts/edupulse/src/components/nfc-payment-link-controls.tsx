import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, ExternalLink, Link2, XCircle } from 'lucide-react';
import {
  cancelNfcPaymentLink,
  createNfcPaymentLink,
  useGetAuthorizedContext,
  type NfcPaymentLink,
  type StudentNfcObligation,
} from '@workspace/api-client-react';
import { Button } from '@/components/shared';
import { SchoolDocumentPrintButton } from '@/components/school-document';
import { NfcServiceBranding } from '@/components/nfc-service-branding';

const minor = (n: number) => `NGN ${(n / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

export function canManageNfcPaymentLink(
  context: { isPlatformOwner?: boolean; roles?: { role: string; status: string; schoolId?: number | null }[] } | undefined,
  row: Pick<StudentNfcObligation, 'schoolId' | 'status' | 'subscriptionId'>,
) {
  if (!context || context.isPlatformOwner || row.subscriptionId == null) return false;
  if (!['UNPAID', 'PENDING', 'FAILED'].includes(row.status)) return false;
  return (context.roles ?? []).some(r => r.status === 'ACTIVE' && (r.role === 'SCHOOL_ADMIN' || r.role === 'ACCOUNTANT') && r.schoolId === row.schoolId);
}

export function canOpenFamilyNfcPaymentLink(
  context: Parameters<typeof canManageNfcPaymentLink>[0],
  row: StudentNfcObligation,
) {
  return !!context && !context.isPlatformOwner && row.canPay && row.subscriptionId != null
    && ['UNPAID', 'FAILED'].includes(row.status)
    && (context.roles ?? []).some(r => r.status === 'ACTIVE' && r.schoolId === row.schoolId
      && ['PARENT', 'STUDENT'].includes(r.role));
}

export function NfcPaymentLinkControls({ row, familyView = false }: { row: StudentNfcObligation; familyView?: boolean }) {
  const context = useGetAuthorizedContext().data;
  const [link, setLink] = useState<NfcPaymentLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copyMsg, setCopyMsg] = useState('');
  const staff = canManageNfcPaymentLink(context as never, row);
  if (!staff && !(familyView && canOpenFamilyNfcPaymentLink(context as never, row))) return null;
  const subscriptionId = row.subscriptionId as number;
  const url = link?.paymentUrl;

  const generate = async () => {
    setBusy(true); setError(''); setCopyMsg('');
    try { setLink(await createNfcPaymentLink(subscriptionId, { termId: row.termId, mode: 'DEVELOPMENT_SIMULATION' })); }
    catch (e) { setError(e instanceof Error ? e.message : 'The payment link could not be generated.'); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true); setError('');
    try { await cancelNfcPaymentLink(subscriptionId); setLink(null); setCopyMsg(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'The payment link could not be cancelled.'); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopyMsg('Link copied.'); }
    catch { setCopyMsg('Copy failed. Select the link text and copy it manually.'); }
  };
  const tid = `${row.studentId}-${row.termId}`;

  return <div className="mt-3 rounded-xl border border-[hsl(var(--border))] p-3 text-xs" data-testid={`nfc-link-${tid}`}>
    <NfcServiceBranding />
    {familyView && <div className="mb-3 space-y-2">
      <Button disabled testId={`button-live-nfc-${tid}`}>Pay NFC Card Fees Through Flutterwave</Button>
      <p>Genuine Flutterwave payment is not currently available. Account approval and verified live settlement configuration are required.</p>
      <p>Use the Development preview below to inspect the public payment page. A simulation does not collect money, issue a genuine receipt or activate a subscription. Ordinary school fees use the school's separate configured payment methods.</p>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => void generate()} disabled={busy} testId={`button-generate-nfc-link-${tid}`}><Link2 size={14} />{link ? 'Retrieve / refresh link' : familyView ? 'Preview Development payment link' : 'Generate payment link'}</Button>
      {link && staff && <Button onClick={() => void cancel()} disabled={busy} testId={`button-cancel-nfc-link-${tid}`}><XCircle size={14} />Cancel link</Button>}
      <span className="text-[hsl(var(--muted-foreground))]">Development simulation link</span>
    </div>
    {error && <p role="alert" className="mt-2 font-semibold text-[hsl(var(--destructive))]">{error}</p>}
    {link && <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
      <dl className="space-y-1">
        <div>Term: <b>{link.termName}, {link.sessionName}</b></div>
        <div>Amount due: <b>{minor(link.amountDueMinor)}</b> of {minor(link.amountMinor)}</div>
        <div>Status: <b>{link.status.replaceAll('_', ' ').toLowerCase()}</b> · Reference <span className="font-mono">{link.reference}</span></div>
        <div>Settlement: unverified. Expires {new Date(link.expiresAt).toLocaleString()}</div>
        <div>Expected allocations (internal): {link.expectedAllocations.map(a => `${a.recipientType.toLowerCase()} ${minor(a.amountMinor)}`).join(', ')}</div>
        {url ? <>
          <div className="break-all rounded-lg bg-[hsl(var(--secondary))] p-2 font-mono" data-testid="nfc-link-url">{url}</div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={() => void copy()} testId={`button-copy-nfc-link-${tid}`}><Copy size={14} />Copy link</Button>
             <a className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 font-semibold" href={url} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} />Open NFC payment page</a>
            <SchoolDocumentPrintButton label="Print instructions" testId={`button-print-nfc-link-${tid}`}>
              <div style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 560 }}>
                <h1 style={{ fontSize: 22 }}>NFC term fee payment instructions</h1>
                <NfcServiceBranding />
                <p>{link.schoolName} · {link.studentIdentifier}</p>
                <p>{link.termName}, {link.sessionName} · Amount due {minor(link.amountDueMinor)}</p>
                <p>Reference {link.reference}. Expires {new Date(link.expiresAt).toLocaleString()}.</p>
                <p>Scan the code or open the link below on a phone. No account is needed.</p>
                <p>School staff can assist if you do not have a suitable device. Cash given to the school does not count as a verified NFC subscription payment.</p>
                <QRCodeSVG value={url} size={180} />
                <p style={{ wordBreak: 'break-all', fontSize: 12 }}>{url}</p>
                <p style={{ fontSize: 12 }}>Development simulation only. This does not collect money or activate a subscription.</p>
              </div>
            </SchoolDocumentPrintButton>
          </div>
          {copyMsg && <p role="status" className="font-semibold">{copyMsg}</p>}
        </> : <p>Retrieve the payment link to share it.</p>}
      </dl>
      {url && <div className="rounded-lg bg-white p-2" aria-label="QR code for payment link"><QRCodeSVG value={url} size={132} /></div>}
    </div>}
  </div>;
}
