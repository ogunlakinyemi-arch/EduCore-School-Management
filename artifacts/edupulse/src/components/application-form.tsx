import type { FormEvent } from 'react';
import { switchApplicantType, type ApplicationValues, type FieldErrors } from '@/lib/application-draft';
import type { ApplicantType } from '@/lib/application-intent';

const inputCls = 'mt-1 w-full min-w-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-sm';

export function ApplicationForm({ values, onChange, errors, formError, pending, onSubmit, submitLabel = 'Submit Application' }: {
  values: ApplicationValues; onChange: (v: ApplicationValues) => void; errors: FieldErrors;
  formError?: string | null; pending?: boolean; onSubmit: () => void; submitLabel?: string;
}) {
  const school = values.applicantType === 'SCHOOL_ADMIN';
  const set = (k: keyof ApplicationValues) => (e: { target: { value: string } }) => onChange({ ...values, [k]: e.target.value });
  const err = (k: keyof ApplicationValues) => errors[k] ? <span role="alert" data-testid={`error-${k}`} className="mt-1 block text-xs font-normal text-[hsl(var(--destructive))]">{errors[k]}</span> : null;
  return (
    <form noValidate className="w-full min-w-0 max-w-sm space-y-4" data-testid="form-application"
      onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(); }}>
      <label className="block text-sm font-semibold">Applying as
        <select data-testid="select-applicant-type" className={inputCls} value={values.applicantType}
          onChange={e => onChange(switchApplicantType(values, e.target.value as ApplicantType))}>
          <option value="SCHOOL_ADMIN">School Admin</option><option value="PARTNER">Partner</option>
        </select>
      </label>
      {school ? (
        <>
          <label className="block text-sm font-semibold">School Name<input className={inputCls} data-testid="input-school-name" value={values.schoolName} onChange={set('schoolName')} />{err('schoolName')}</label>
          <label className="block text-sm font-semibold">School Address (optional)<input className={inputCls} data-testid="input-address" value={values.address} onChange={set('address')} />{err('address')}</label>
          <label className="block text-sm font-semibold">School Admin Full Name<input className={inputCls} autoComplete="name" data-testid="input-full-name" value={values.fullName} onChange={set('fullName')} />{err('fullName')}</label>
          <label className="block text-sm font-semibold">School Admin Email (required)<input className={inputCls} type="email" autoComplete="email" required aria-invalid={!!errors.email} data-testid="input-email" value={values.email} onChange={set('email')} />{err('email')}</label>
          <label className="block text-sm font-semibold">School Admin Phone Number<input className={inputCls} type="tel" autoComplete="tel" data-testid="input-phone" value={values.phone} onChange={set('phone')} />{err('phone')}</label>
        </>
      ) : (
        <>
          <label className="block text-sm font-semibold">Partner Full Name<input className={inputCls} autoComplete="name" data-testid="input-full-name" value={values.fullName} onChange={set('fullName')} />{err('fullName')}</label>
          <label className="block text-sm font-semibold">Email<input className={inputCls} type="email" autoComplete="email" data-testid="input-email" value={values.email} onChange={set('email')} />{err('email')}</label>
          <label className="block text-sm font-semibold">Phone<input className={inputCls} type="tel" autoComplete="tel" data-testid="input-phone" value={values.phone} onChange={set('phone')} />{err('phone')}</label>
          <label className="block text-sm font-semibold">Business Name (optional)<input className={inputCls} data-testid="input-business-name" value={values.businessName} onChange={set('businessName')} />{err('businessName')}</label>
          <label className="block text-sm font-semibold">Partner Type
            <select className={inputCls} data-testid="select-partner-type" value={values.partnerType} onChange={set('partnerType')}>
              <option value="">Choose a type</option><option value="BUSINESS">Business</option><option value="INDIVIDUAL">Individual</option>
            </select>{err('partnerType')}
          </label>
        </>
      )}
      {formError && <p role="alert" data-testid="text-apply-error" className="text-sm text-[hsl(var(--destructive))]">{formError}</p>}
      <button type="submit" disabled={pending} data-testid="button-submit-application" className="w-full rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))]">
        {pending ? 'Submitting…' : submitLabel}
      </button>
    </form>
  );
}
