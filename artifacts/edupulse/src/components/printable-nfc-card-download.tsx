import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadPrintableNfcCard } from '@workspace/api-client-react';
import { Button } from '@/components/shared';

const PRINTABLE_CARD_LABEL = 'Download Printable ID Card';

function errorMessage(error: unknown) {
  const value = error as { data?: { error?: string }; message?: string } | null;
  return value?.data?.error || value?.message || 'The printable ID card could not be downloaded.';
}

function isPdf(blob: Blob) {
  if (blob.type && blob.type.split(';', 1)[0].trim().toLowerCase() !== 'application/pdf') return false;
  return blob.slice(0, 5).text().then(signature => signature === '%PDF-');
}

export function savePrintableNfcCardPdf(blob: Blob, cardId: number) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `nfc-card-${cardId}.pdf`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Let the browser finish consuming the object URL before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

type Props = {
  cardId: number | null | undefined;
  schoolId: number;
  ownerAuthorized: boolean;
  cardType: 'STUDENT' | 'TEACHER' | 'STAFF';
  cardStatus: string;
};

/** Owner-only reprint/download control; downloading never mutates card assignments. */
export function PrintableNfcCardDownload({
  cardId, schoolId, ownerAuthorized, cardType, cardStatus,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const normalizedStatus = cardStatus.toUpperCase();
  const eligibleStatus = cardType === 'STUDENT'
    ? normalizedStatus === 'ACTIVE'
    // The employee API reports an assigned, unpaid card as effective LOCKED.
    // The download endpoint validates its underlying assignment; printing does
    // not activate or unlock it.
    : ['ASSIGNED', 'ACTIVE', 'LOCKED'].includes(normalizedStatus);
  const eligible = ownerAuthorized && Number.isInteger(cardId) && Number(cardId) > 0 &&
    Number.isInteger(schoolId) && schoolId > 0 && eligibleStatus;

  if (!eligible) return null;

  const download = async () => {
    if (!eligible || cardId == null) return;
    setBusy(true);
    setError('');
    try {
      const blob = await downloadPrintableNfcCard(cardId, { schoolId }, { responseType: 'blob' });
      if (!(blob instanceof Blob) || !(await isPdf(blob))) {
        throw new Error('The server did not return a valid PDF file.');
      }
      savePrintableNfcCardPdf(blob, cardId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button variant="outline" disabled={busy} onClick={download} testId={`button-download-nfc-card-${cardId}`}>
        <Download size={14} />{busy ? 'Preparing PDF…' : PRINTABLE_CARD_LABEL}
      </Button>
      {error && <p role="alert" className="mt-2 text-sm text-[hsl(var(--destructive))]">{error}</p>}
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
        Print-ready CR80 front and back; student cards show permanent identification only.
      </p>
    </div>
  );
}