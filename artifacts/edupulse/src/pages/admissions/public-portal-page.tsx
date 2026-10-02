import { useRef, useState, type FormEvent } from 'react';
import { useRoute } from 'wouter';
import { Copy, Download, FileSearch, GraduationCap, ShieldCheck } from 'lucide-react';
import {
  useGetPublicAdmissionPortal, getGetPublicAdmissionPortalQueryKey, useSubmitPublicAdmissionApplication, useTrackAdmissionApplication,
  useRequestPublicAdmissionDocumentUpload,
  type PublicAdmissionApplicationReceipt, type PublicAdmissionApplicationStatus,
} from '@workspace/api-client-react';
import { Button, Field, IconLogo, StatusPill, ErrorState, EmptyState, cx, date } from '@/components/shared';
import { ApplicationForm, type SubmitPayload, type UploadFn } from './application-form';
import {
  resolveRequestKey, liveKeyRequest, apiMessage, uploadInput, putToSignedUrl, normalizePhone, receiptText, type KeyHolder,
} from './admissions-lib';

export function ReceiptCard({ receipt, schoolName }: { receipt: PublicAdmissionApplicationReceipt; schoolName?: string }) {
  const [copied, setCopied] = useState('');
  const copy = async (label: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); } catch { setCopied('failed'); }
  };
  const save = () => {
    const url = URL.createObjectURL(new Blob([receiptText(receipt, schoolName)], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = `admission-${receipt.applicationNumber}.txt`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="panel space-y-5 p-6 md:p-8" role="status" data-testid="admission-receipt">
      <div className="eyebrow">Application received</div>
      <h2 className="display-font text-2xl font-bold">Save these details now.</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
          <div className="eyebrow">Application number</div>
          <div className="mt-1.5 break-all font-mono text-lg font-bold" data-testid="text-application-number">{receipt.applicationNumber}</div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
          <div className="eyebrow">Tracking code</div>
          <div className="mt-1.5 break-all font-mono text-sm font-bold" data-testid="text-tracking-code">{receipt.receiptSecret}</div>
        </div>
      </div>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        This code is shown once and cannot be recovered. Keep it private; you need it with the application number and guardian phone number to track progress.
      </p>
      <p className="text-sm" data-testid="text-confirmation-delivery">
        Confirmation message: <strong>{receipt.confirmation.deliveryStatus.replace('_', ' ').toLowerCase()}</strong>. {receipt.confirmation.message}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => copy('number', receipt.applicationNumber)}><Copy size={15} />Copy number</Button>
        <Button variant="outline" onClick={() => copy('code', receipt.receiptSecret)}><Copy size={15} />Copy code</Button>
        <Button onClick={save}><Download size={15} />Save receipt</Button>
      </div>
      {copied && <p role="status" className="text-xs font-medium">{copied === 'failed' ? 'Copy was blocked by your browser. Select the text or use Save receipt.' : `Copied ${copied}.`}</p>}
    </div>
  );
}

function TrackPanel() {
  const track = useTrackAdmissionApplication();
  const [num, setNum] = useState(''); const [phone, setPhone] = useState(''); const [code, setCode] = useState('');
  const [err, setErr] = useState(''); const [result, setResult] = useState<PublicAdmissionApplicationStatus | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(''); setResult(null);
    const p = normalizePhone(phone);
    if (!num.trim()) return setErr('Enter the application number.');
    if (!p) return setErr('Enter the guardian phone number used on the application.');
    if (code.trim().length < 32) return setErr('Enter the full tracking code from your receipt.');
    track.mutate({ data: { applicationNumber: num.trim(), phone: p, receiptSecret: code.trim() } }, {
      onSuccess: r => { setResult(r); setCode(''); },
      onError: e2 => setErr(apiMessage(e2, 'No application matched those details.')),
    });
  };
  return (
    <form onSubmit={submit} className="panel space-y-5 p-6 md:p-8" noValidate data-testid="form-track-application">
      <div><div className="eyebrow">Track</div><h2 className="display-font text-2xl font-bold">Check application progress</h2></div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Application number"><input value={num} onChange={e => setNum(e.target.value)} autoComplete="off" /></Field>
        <Field label="Guardian phone number"><input type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></Field>
      </div>
      <Field label="Tracking code"><input value={code} onChange={e => setCode(e.target.value)} autoComplete="off" className="font-mono" type="password" /></Field>
      {err && <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]">{err}</p>}
      <Button type="submit" disabled={track.isPending} testId="button-track"><FileSearch size={15} />{track.isPending ? 'Checking…' : 'Check status'}</Button>
      {result && (
        <div className="rounded-2xl border border-[hsl(var(--border))] p-4" data-testid="track-result">
          <div className="flex flex-wrap items-center gap-3"><span className="font-mono text-sm font-bold">{result.applicationNumber}</span><StatusPill value={result.status} /></div>
          {result.publicMessage && <p className="mt-3 text-sm">{result.publicMessage}</p>}
          <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Updated {date(result.updatedAt)}</p>
        </div>
      )}
    </form>
  );
}

export function PublicAdmissionPortalPage() {
  const [, params] = useRoute<{ portalKey: string }>('/admissions/portal/:portalKey');
  const portalKey = params?.portalKey ?? '';
  const keyRef = useRef('');
  const portal = useGetPublicAdmissionPortal(portalKey, { query: { enabled: !!portalKey, queryKey: getGetPublicAdmissionPortalQueryKey(portalKey), retry: false } });
  const submit = useSubmitPublicAdmissionApplication({ request: liveKeyRequest(keyRef) });
  const requestUpload = useRequestPublicAdmissionDocumentUpload();
  const [tab, setTab] = useState<'apply' | 'track'>('apply');
  const [receipt, setReceipt] = useState<PublicAdmissionApplicationReceipt | null>(null);
  const [error, setError] = useState(''); const [resetSignal, setResetSignal] = useState(0);
  const holder = useRef<KeyHolder['current']>(null) as KeyHolder;

  const upload: UploadFn = async (file, documentType) => {
    const target = await requestUpload.mutateAsync({ portalKey, data: uploadInput(file, documentType) });
    await putToSignedUrl(target.uploadUrl, file);
    return { documentType, fileName: file.name, contentType: file.type as never, byteSize: file.size, objectPath: target.objectPath };
  };

  const onSubmit = (payload: SubmitPayload) => {
    setError('');
    keyRef.current = resolveRequestKey(holder, payload);
    submit.mutate({ portalKey, data: payload }, {
      onSuccess: r => { holder.current = null; setReceipt(r); setResetSignal(n => n + 1); window.scrollTo?.({ top: 0 }); },
      onError: e => setError(apiMessage(e, 'The application could not be submitted. You can retry safely; it will not create a duplicate.')),
    });
  };

  const data = portal.data;
  const school = data?.school;
  return (
    <div className="min-h-[100dvh] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <header className="bg-[hsl(var(--sidebar))] px-5 py-4 md:px-10"><IconLogo /></header>
      <main className="mx-auto max-w-4xl space-y-8 px-5 py-8 md:py-12">
        {portal.isLoading ? (
          <div className="space-y-4 animate-pulse" aria-busy="true"><div className="h-12 w-2/3 rounded-xl bg-[hsl(var(--muted))]" /><div className="h-64 rounded-2xl bg-[hsl(var(--muted))]" /></div>
        ) : portal.isError || !data || !school ? (
          (portal.error as { status?: number } | null)?.status === 404
            ? <EmptyState icon={GraduationCap} title="Admissions page not found" description="Check the link you were given, or contact the school directly." />
            : <ErrorState retry={() => portal.refetch()} message="The admissions page could not be loaded. Retry when your connection is ready." />
        ) : (
          <>
            <section className="flex flex-col gap-5 sm:flex-row sm:items-center">
              {school.logoUrl && <img src={school.logoUrl} alt={`${school.name} logo`} className="h-20 w-20 rounded-2xl object-contain" />}
              <div>
                <div className="eyebrow mb-2">Admissions{data.admission.session ? ` / ${data.admission.session}` : ''}{data.admission.term ? ` / ${data.admission.term}` : ''}</div>
                <h1 className="display-font text-3xl font-bold md:text-4xl" data-testid="heading-portal-school">{school.name}</h1>
                {school.description && <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{school.description}</p>}
              </div>
            </section>
            <section className="grid gap-4 md:grid-cols-2">
              <Info2 title="Admission status" lines={[data.admission.open ? 'Applications are open' : 'Applications are closed', data.admission.deadline ? `Deadline: ${date(data.admission.deadline)}` : '']} />
              <Info2 title="Contact" lines={[school.address ?? '', school.publicPhone ?? '', school.publicEmail ?? '']} />
              <Info2 title="Fees" lines={[data.admission.feeInfo ?? '']} />
              <Info2 title="Requirements" lines={[...(data.admission.requirements ?? []), ...(data.admission.requiredDocuments ?? []).map(d => `Document: ${d}`)]} />
              <Info2 title="Instructions" lines={[data.admission.instructions ?? '']} />
              <Info2 title="Entrance examination and interview" lines={[data.admission.entranceExamination ?? '', data.admission.interviewInformation ?? '']} />
            </section>
            <div className="flex gap-2" role="tablist">
              {(['apply', 'track'] as const).map(t => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('rounded-xl px-5 py-2.5 text-sm font-bold', tab === t ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--secondary))]')} data-testid={`tab-${t}`}>
                  {t === 'apply' ? 'Apply' : 'Track application'}
                </button>
              ))}
            </div>
            {tab === 'track' ? <TrackPanel /> : receipt ? (
              <div className="space-y-4">
                <ReceiptCard receipt={receipt} schoolName={school.name} />
                <Button variant="outline" onClick={() => setReceipt(null)}>Start another application</Button>
              </div>
            ) : !data.admission.open ? (
              <EmptyState icon={ShieldCheck} title="Applications are closed" description="This school is not accepting applications right now. Contact the school for details." />
            ) : (
              <div className="panel p-6 md:p-8">
                <ApplicationForm mode="public" classes={data.availableClasses} requiredDocuments={data.admission.requiredDocuments ?? []} upload={upload} pending={submit.isPending} error={error} onSubmit={onSubmit} resetSignal={resetSignal} />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Info2({ title, lines }: { title: string; lines: string[] }) {
  const shown = lines.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
      <div className="eyebrow mb-2">{title}</div>
      <ul className="space-y-1 text-sm">{shown.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}
