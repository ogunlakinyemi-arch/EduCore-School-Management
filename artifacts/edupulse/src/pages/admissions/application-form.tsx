import { useRef, useState, type FormEvent } from 'react';
import { Paperclip, Upload, X } from 'lucide-react';
import type { AdmissionDocumentInput } from '@workspace/api-client-react';
import { Button, Field } from '@/components/shared';
import {
  GENDERS, emptyForm, validateForm, buildPayload, checkFile, putToSignedUrl, type FormValues, type FormErrors,
} from './admissions-lib';

export type UploadFn = (file: File, documentType: string) => Promise<AdmissionDocumentInput>;
export type SubmitPayload = ReturnType<typeof buildPayload>;

type Props = {
  mode: 'public' | 'staff';
  classes: Array<{ id: number; name: string; section?: string }>;
  sessions?: Array<{ id: number; name: string }>;
  terms?: Array<{ id: number; name: string; sessionId: number }>;
  requiredDocuments?: string[];
  upload: UploadFn;
  pending: boolean;
  error?: string;
  onSubmit: (payload: SubmitPayload, saveAsDraft: boolean) => void;
  /** Increment to clear the form after a successful submit. */
  resetSignal?: number;
  initial?: FormValues;
  editing?: boolean;
  onSessionChange?: (sessionId: number | null) => void;
  onCancel?: () => void;
};

export function ApplicationForm({ mode, classes, sessions, terms, requiredDocuments = [], upload, pending, error, onSubmit, resetSignal = 0, initial, editing = false, onSessionChange, onCancel }: Props) {
  const [values, setValues] = useState<FormValues>(initial ?? emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [docs, setDocs] = useState<AdmissionDocumentInput[]>([]);
  const [photo, setPhoto] = useState<{ path: string; name: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [fileError, setFileError] = useState('');
  const [docType, setDocType] = useState(requiredDocuments[0] ?? '');
  const lastReset = useRef(resetSignal);
  if (lastReset.current !== resetSignal) {
    lastReset.current = resetSignal;
    setValues(initial ?? emptyForm); setErrors({}); setDocs([]); setPhoto(null); setFileError('');
  }
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => setValues(v => ({ ...v, [k]: e.target.value }));
  const termOptions = terms ?? [];

  const handlePhoto = async (file?: File) => {
    if (!file) return;
    const problem = checkFile(file, 'photo');
    if (problem) { setFileError(problem); return; }
    setFileError(''); setBusy('photo');
    try { const d = await upload(file, 'photograph'); setPhoto({ path: d.objectPath, name: file.name }); }
    catch (e) { setFileError(e instanceof Error ? e.message : 'Photograph upload failed.'); }
    finally { setBusy(''); }
  };
  const handleDoc = async (file?: File) => {
    if (!file) return;
    const type = docType.trim() || 'other';
    const problem = checkFile(file, 'document');
    if (problem) { setFileError(problem); return; }
    setFileError(''); setBusy('doc');
    try { const d = await upload(file, type); setDocs(list => [...list.filter(x => x.documentType !== type || type === 'other'), d]); }
    catch (e) { setFileError(e instanceof Error ? e.message : 'Document upload failed.'); }
    finally { setBusy(''); }
  };

  const submit = (draft: boolean) => (e?: FormEvent) => {
    e?.preventDefault();
    const found = validateForm(values, { requiredDocuments: mode === 'public' ? requiredDocuments : [], documents: docs, draft: draft || editing });
    setErrors(found);
    if (Object.keys(found).length) return;
    onSubmit(buildPayload(values, photo?.path, docs), draft);
  };
  const disabled = pending || !!busy;
  const inputErr = (k: keyof FormValues) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `err-${k}` : undefined });

  return (
    <form onSubmit={submit(false)} className="space-y-8" noValidate data-testid="form-admission-application">
      <fieldset className="space-y-5">
        <legend className="eyebrow mb-3">Applicant</legend>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="First name" error={errors.firstName}><input value={values.firstName} onChange={set('firstName')} autoComplete="given-name" {...inputErr('firstName')} /></Field>
          <Field label="Middle name (optional)"><input value={values.middleName} onChange={set('middleName')} /></Field>
          <Field label="Last name" error={errors.lastName}><input value={values.lastName} onChange={set('lastName')} autoComplete="family-name" {...inputErr('lastName')} /></Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Date of birth" error={errors.dateOfBirth}><input type="date" value={values.dateOfBirth} onChange={set('dateOfBirth')} {...inputErr('dateOfBirth')} /></Field>
          <Field label="Gender" error={errors.gender}>
            <select value={values.gender} onChange={set('gender')} {...inputErr('gender')}>
              <option value="">Select</option>
              {GENDERS.map(g => <option key={g} value={g}>{g === 'PreferNotToSay' ? 'Prefer not to say' : g}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Previous school (optional)"><input value={values.previousSchool} onChange={set('previousSchool')} /></Field>
          <Field label="Previous class (optional)"><input value={values.previousClass} onChange={set('previousClass')} /></Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Class applied for" error={errors.intendedClassId}>
            <select value={values.intendedClassId} onChange={set('intendedClassId')} {...inputErr('intendedClassId')}>
              <option value="">Select class</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.section ? ` ${c.section}` : ''}</option>)}
            </select>
          </Field>
          {mode === 'staff' && sessions && (
            <Field label="Session">
              <select value={values.academicSessionId} onChange={e => { setValues(v => ({ ...v, academicSessionId: e.target.value, academicTermId: '' })); onSessionChange?.(e.target.value ? Number(e.target.value) : null); }}>
                <option value="">Portal default</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {mode === 'staff' && terms && (values.academicSessionId !== '') && (
            <Field label="Term">
              <select value={values.academicTermId} onChange={set('academicTermId')}>
                <option value="">No term</option>{termOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label="Home address (optional)"><input value={values.address} onChange={set('address')} autoComplete="street-address" /></Field>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="eyebrow mb-3">Parent or guardian</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name" error={errors.guardianName}><input value={values.guardianName} onChange={set('guardianName')} autoComplete="name" {...inputErr('guardianName')} /></Field>
          <Field label="Phone number" error={errors.guardianPhone}><input type="tel" inputMode="tel" value={values.guardianPhone} onChange={set('guardianPhone')} placeholder="08031234567" autoComplete="tel" {...inputErr('guardianPhone')} /></Field>
          <Field label="Email (optional)" error={errors.guardianEmail}><input type="email" value={values.guardianEmail} onChange={set('guardianEmail')} {...inputErr('guardianEmail')} /></Field>
          <Field label="Relationship (optional)"><input value={values.guardianRelationship} onChange={set('guardianRelationship')} placeholder="Mother, father, uncle" /></Field>
        </div>
        <Field label="Guardian address (optional)"><input value={values.guardianAddress} onChange={set('guardianAddress')} /></Field>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Your phone number is used to track this application. An email is not required.</p>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="eyebrow mb-3">Emergency contact</legend>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Full name" error={errors.emergencyName}><input value={values.emergencyName} onChange={set('emergencyName')} {...inputErr('emergencyName')} /></Field>
          <Field label="Phone number" error={errors.emergencyPhone}><input type="tel" inputMode="tel" value={values.emergencyPhone} onChange={set('emergencyPhone')} {...inputErr('emergencyPhone')} /></Field>
          <Field label="Relationship (optional)"><input value={values.emergencyRelationship} onChange={set('emergencyRelationship')} /></Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4" hidden={editing}>
        <legend className="eyebrow mb-3">Photograph and documents</legend>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-sm font-bold">
            <Upload size={15} />{busy === 'photo' ? 'Uploading…' : photo ? 'Replace photograph' : 'Upload photograph'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={disabled} onChange={e => { void handlePhoto(e.target.files?.[0]); e.target.value = ''; }} data-testid="input-admission-photo" />
          </label>
          {photo && <span className="text-xs font-medium">{photo.name}</span>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Document type">
            {requiredDocuments.length ? (
              <select value={docType} onChange={e => setDocType(e.target.value)}>
                {requiredDocuments.map(d => <option key={d} value={d}>{d}</option>)}<option value="other">Other</option>
              </select>
            ) : <input value={docType} onChange={e => setDocType(e.target.value)} placeholder="Birth certificate" />}
          </Field>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-sm font-bold">
            <Paperclip size={15} />{busy === 'doc' ? 'Uploading…' : 'Attach file'}
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" disabled={disabled} onChange={e => { void handleDoc(e.target.files?.[0]); e.target.value = ''; }} data-testid="input-admission-document" />
          </label>
        </div>
        {docs.length > 0 && (
          <ul className="space-y-2">
            {docs.map(d => (
              <li key={d.objectPath} className="flex items-center justify-between rounded-xl bg-[hsl(var(--muted)/.5)] px-3 py-2 text-xs">
                <span><strong>{d.documentType}</strong> · {d.fileName}</span>
                <button type="button" aria-label={`Remove ${d.fileName}`} onClick={() => setDocs(l => l.filter(x => x.objectPath !== d.objectPath))}><X size={14} /></button>
              </li>
            ))}
          </ul>
        )}
        {errors.documents && <p id="err-documents" role="alert" className="text-xs font-medium text-[hsl(var(--destructive))]">{errors.documents}</p>}
        {fileError && <p role="alert" className="text-xs font-medium text-[hsl(var(--destructive))]">{fileError}</p>}
        <p className="text-xs text-[hsl(var(--muted-foreground))]">PDF, JPEG, PNG or WebP, up to 5 MB each.</p>
      </fieldset>

      {error && <p role="alert" className="rounded-xl bg-[hsl(var(--destructive)/.1)] p-3 text-sm font-medium text-[hsl(var(--destructive))]" data-testid="text-admission-error">{error}</p>}
      <div className="flex flex-wrap justify-end gap-3 border-t border-[hsl(var(--border))] pt-5">
        {editing && onCancel && <Button variant="outline" onClick={onCancel}>Cancel</Button>}
        {mode === 'staff' && !editing && <Button variant="outline" disabled={disabled} onClick={() => submit(true)()} testId="button-save-draft">Save as draft</Button>}
        <Button type="submit" disabled={disabled} testId="button-submit-application">{pending ? (editing ? 'Saving…' : 'Submitting…') : editing ? 'Save changes' : 'Submit application'}</Button>
      </div>
    </form>
  );
}
