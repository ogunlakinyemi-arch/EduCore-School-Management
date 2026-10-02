import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Landmark, ShieldCheck, Upload } from 'lucide-react';
import {
  useGetSchoolBranding, getGetSchoolBrandingQueryKey, useUpdateSchoolBranding,
  useRequestSchoolLogoUpload, getGetCurrentUserSchoolsQueryKey, useConfirmSchoolLogoUpload, useGetSchoolLogo, getGetSchoolLogoQueryKey,
  type SchoolBranding,
} from '@workspace/api-client-react';
import { PageHeading, Button, Field, SkeletonPage, ErrorState, EmptyState, TenantPicker } from '@/components/shared';
import { FRESH, Notice, errMsg, useSchoolRole } from '@/components/school-ops-kit';

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'] as const;
type Mime = (typeof ALLOWED)[number];
const MAX_BYTES = 3_145_728;

export async function sniffImageType(file: Blob): Promise<Mime | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

const blank = { name: '', registrationNumber: '', address: '', city: '', state: '', lga: '', phone: '', email: '', website: '', schoolType: '' };
type FormState = typeof blank;
const fromBranding = (b: SchoolBranding): FormState => ({
  name: b.name ?? '', registrationNumber: b.registrationNumber ?? '', address: b.address ?? '', city: b.city ?? '', state: b.state ?? '',
  lga: b.lga ?? '', phone: b.phone ?? '', email: b.email ?? '', website: b.website ?? '', schoolType: b.schoolType ?? '',
});

export function SchoolBrandingPage() {
  const role = useSchoolRole();
  const { schoolId, canManage } = role;
  const qc = useQueryClient();
  const query = useGetSchoolBranding(schoolId, { query: { enabled: canManage, queryKey: getGetSchoolBrandingQueryKey(schoolId), ...FRESH } });
  const branding = query.data;
  const [form, setForm] = useState<FormState>(blank);
  const initFor = useRef<number | null>(null);
  const [saved, setSaved] = useState('');
  const [logoMsg, setLogoMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (branding && initFor.current !== branding.schoolId) { initFor.current = branding.schoolId; setForm(fromBranding(branding)); }
  }, [branding]);
  useEffect(() => { initFor.current = null; setSaved(''); setPicked(null); setLogoMsg(null); }, [schoolId]);
  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked.url); }, [picked]);

  const logoQuery = useGetSchoolLogo(schoolId, { query: { enabled: canManage && !!branding?.logoUrl, queryKey: getGetSchoolLogoQueryKey(schoolId), ...FRESH } });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (logoQuery.data instanceof Blob) { const u = URL.createObjectURL(logoQuery.data); setLogoUrl(u); return () => URL.revokeObjectURL(u); }
    setLogoUrl(null);
    return undefined;
  }, [logoQuery.data]);

  const update = useUpdateSchoolBranding();
  const requestUpload = useRequestSchoolLogoUpload();
  const confirmUpload = useConfirmSchoolLogoUpload();
  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = (e: FormEvent) => {
    e.preventDefault(); setSaved('');
    const n = (v: string) => (v.trim() === '' ? null : v.trim());
    update.mutate({ schoolId, data: {
      name: form.name.trim(), city: form.city.trim(), state: form.state.trim(),
      registrationNumber: n(form.registrationNumber), address: n(form.address), lga: n(form.lga), phone: n(form.phone),
      email: n(form.email), website: n(form.website), schoolType: n(form.schoolType),
    } }, { onSuccess: next => {
      initFor.current = next.schoolId; setForm(fromBranding(next)); setSaved('Official school details saved.');
      qc.invalidateQueries({ queryKey: getGetSchoolBrandingQueryKey(schoolId) });
      refreshBrand();
    } });
  };

  const refreshBrand = () => {
    qc.invalidateQueries({ queryKey: getGetSchoolBrandingQueryKey(schoolId) });
    qc.invalidateQueries({ queryKey: getGetSchoolLogoQueryKey(schoolId) });
    qc.invalidateQueries({ queryKey: getGetCurrentUserSchoolsQueryKey() });
    // Any other consumer (header logo, brand filters) keyed under this school's branding/logo.
    qc.invalidateQueries({ predicate: q => { const k = q.queryKey[0]; return typeof k === 'string' && k.startsWith(`/api/schools/${schoolId}/`) && /branding|logo/.test(k); } });
  };

  const choose = async (file: File | undefined) => {
    setLogoMsg(null);
    if (!file) return;
    if (file.size < 1 || file.size > MAX_BYTES) return setLogoMsg({ tone: 'error', text: 'Logo must be between 1 byte and 3 MB.' });
    const sniffed = await sniffImageType(file);
    if (!sniffed || !(ALLOWED as readonly string[]).includes(file.type) || sniffed !== file.type) {
      return setLogoMsg({ tone: 'error', text: 'Use a genuine PNG, JPEG or WebP image.' });
    }
    setPicked({ file, url: URL.createObjectURL(file) });
  };

  const upload = async () => {
    if (!picked) return;
    setBusy(true); setLogoMsg(null);
    try {
      const target = await requestUpload.mutateAsync({ schoolId, data: { contentType: picked.file.type as Mime, size: picked.file.size } });
      const put = await fetch(target.uploadURL, { method: 'PUT', headers: { 'Content-Type': picked.file.type }, body: picked.file });
      if (!put.ok) throw new Error('upload');
      await confirmUpload.mutateAsync({ schoolId, data: { objectPath: target.objectPath } });
      setPicked(null);
      setLogoMsg({ tone: 'success', text: 'Logo replaced.' });
      refreshBrand();
    } catch (err) {
      setLogoMsg({ tone: 'error', text: err instanceof Error && err.message === 'upload' ? 'The file could not be sent to storage. Try again.' : errMsg(err, 'Logo upload failed. Try again.') });
    } finally { setBusy(false); }
  };

  const preview = picked?.url ?? logoUrl;

  return (
    <div className="fade-up">
      <PageHeading eyebrow="Settings / Identity" title="School branding." description="Official contact details and the logo families see on documents and portals."
        action={<TenantPicker />} />
      {role.loading ? <SkeletonPage /> : !schoolId ? (
        <EmptyState icon={Landmark} title="Select a school" description="Choose the school whose identity you want to manage." />
      ) : !canManage ? (
        <EmptyState icon={ShieldCheck} title="School Administrators only" description="Branding is managed by the School Administrator of the selected school." />
      ) : query.isLoading ? <SkeletonPage /> : query.isError ? <ErrorState retry={() => query.refetch()} message={errMsg(query.error, 'Branding could not be loaded.')} /> : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <section className="panel h-fit p-6" aria-label="School logo">
            <div className="eyebrow mb-4">Logo</div>
            <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/.4)]">
              {preview ? <img src={preview} alt="School logo" className="h-full w-full object-contain p-4" data-testid="img-school-logo" />
                : <div className="text-center text-xs text-[hsl(var(--muted-foreground))]"><ImagePlus className="mx-auto mb-2" size={28} />No logo yet</div>}
            </div>
            <input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} data-testid="input-logo-file" />
            <div className="mt-4 flex flex-wrap gap-2">
              <label htmlFor="logo-file" className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-sm font-bold hover:border-[hsl(var(--primary)/.4)]">
                <ImagePlus size={15} />{branding?.logoUrl || picked ? 'Choose another' : 'Choose image'}
              </label>
              {picked && <Button onClick={upload} disabled={busy} testId="button-upload-logo"><Upload size={15} />{busy ? 'Uploading…' : branding?.logoUrl ? 'Replace logo' : 'Upload logo'}</Button>}
              {picked && !busy && <Button variant="quiet" onClick={() => setPicked(null)}>Discard</Button>}
            </div>
            <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">PNG, JPEG or WebP, up to 3 MB.</p>
            {logoQuery.isError && <div className="mt-3"><Notice tone="error">Current logo could not be displayed.</Notice></div>}
            {logoMsg && <div className="mt-3"><Notice tone={logoMsg.tone}>{logoMsg.text}</Notice></div>}
          </section>

          <form onSubmit={save} className="panel space-y-5 p-6 md:p-8" aria-label="Official details">
            <div className="eyebrow">Official details</div>
            <Field label="School name"><input required maxLength={200} value={form.name} onChange={e => set('name', e.target.value)} /></Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Registration number (permanent)"><input readOnly value={form.registrationNumber || 'Not recorded for this legacy school'} className="font-mono" /></Field>
              <Field label="School type"><input maxLength={100} value={form.schoolType} onChange={e => set('schoolType', e.target.value)} placeholder="e.g. Primary and Secondary" /></Field>
            </div>
            <Field label="Address"><input maxLength={500} value={form.address} onChange={e => set('address', e.target.value)} /></Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="City"><input required maxLength={160} value={form.city} onChange={e => set('city', e.target.value)} /></Field>
              <Field label="State"><input required maxLength={160} value={form.state} onChange={e => set('state', e.target.value)} /></Field>
              <Field label="LGA"><input maxLength={160} value={form.lga} onChange={e => set('lga', e.target.value)} /></Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Phone"><input maxLength={50} value={form.phone} onChange={e => set('phone', e.target.value)} /></Field>
              <Field label="Official email"><input type="email" maxLength={254} value={form.email} onChange={e => set('email', e.target.value)} /></Field>
            </div>
            <Field label="Website"><input maxLength={255} value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://" /></Field>
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[hsl(var(--border))] pt-5">
              {saved && <span className="mr-auto"><Notice tone="success">{saved}</Notice></span>}
              {update.isError && <span className="mr-auto"><Notice tone="error">{errMsg(update.error)}</Notice></span>}
              <Button type="submit" disabled={update.isPending} testId="button-save-branding">{update.isPending ? 'Saving…' : 'Save details'}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
