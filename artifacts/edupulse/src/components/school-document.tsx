import { useRef, useState, type ReactNode } from 'react';
import { Printer } from 'lucide-react';
import { getGetSchoolBrandingQueryKey, useGetSchoolBranding } from '@workspace/api-client-react';
import type { SchoolBranding } from '@workspace/api-client-react';

type DocumentBranding = Partial<Pick<
  SchoolBranding,
  'schoolId' | 'name' | 'logoUrl' | 'address' | 'city' | 'state' | 'phone' | 'email' | 'website'
>>;

export function useSchoolDocumentBranding(schoolId: number) {
  return useGetSchoolBranding(schoolId, {
    query: {
      enabled: Number.isSafeInteger(schoolId) && schoolId > 0,
      queryKey: getGetSchoolBrandingQueryKey(schoolId),
    },
  });
}

function sameOriginLogoUrl(value: string): string | null {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function SchoolDocumentHeader({ branding }: { branding: DocumentBranding }) {
  const logoUrl = branding.logoUrl ? sameOriginLogoUrl(branding.logoUrl) : null;
  const invalidLogoUrl = !!branding.logoUrl && !logoUrl;
  const contact = [
    branding.address,
    [branding.city, branding.state].filter(Boolean).join(', '),
    branding.phone,
    branding.email,
    branding.website,
  ].filter((value): value is string => typeof value === 'string' && !!value.trim());

  return (
    <header className="school-document-header">
      {logoUrl && <img className="school-document-logo" src={logoUrl} alt={`${branding.name || 'School'} logo`} />}
      <div className="school-document-identity">
        {branding.name && <h1>{branding.name}</h1>}
        {contact.map((value, index) => <div key={`${index}-${value}`}>{value}</div>)}
        {invalidLogoUrl && <p data-school-logo-invalid="true" className="school-document-error">The school logo URL is not same-origin and cannot be included in a secure printout.</p>}
      </div>
    </header>
  );
}

export function SchoolDocumentPrintButton({
  children,
  label = 'Print',
  disabled = false,
  unavailableMessage,
  testId,
  className = '',
  preview = false,
}: {
  children: ReactNode;
  label?: string;
  disabled?: boolean;
  unavailableMessage?: string;
  testId?: string;
  className?: string;
  preview?: boolean;
}) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);
  const [failure, setFailure] = useState('');

  const print = async () => {
    const source = sourceRef.current;
    if (!source || disabled || printing) return;
    setFailure('');
    setPrinting(true);
    try {
      if (source.querySelector('[data-school-logo-invalid="true"]')) {
        throw new Error('The school logo URL is not same-origin. Update school branding before printing.');
      }
      const images = Array.from(source.querySelectorAll('img'));
      await Promise.all(images.map(image => {
        if (image.complete) {
          if (image.naturalWidth > 0) return Promise.resolve();
          return Promise.reject(new Error('The school logo could not be loaded. Check access to school branding and try again.'));
        }
        return new Promise<void>((resolve, reject) => {
          const loaded = () => {
            image.removeEventListener('error', failed);
            resolve();
          };
          const failed = () => {
            image.removeEventListener('load', loaded);
            reject(new Error('The school logo could not be loaded. Check access to school branding and try again.'));
          };
          image.addEventListener('load', loaded, { once: true });
          image.addEventListener('error', failed, { once: true });
          if (image.complete) {
            if (image.naturalWidth > 0) loaded();
            else failed();
          }
        });
      }));
      source.dataset.schoolPrintActive = 'true';
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      const cleanup = () => {
        delete source.dataset.schoolPrintActive;
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.setTimeout(cleanup, 60_000);
      window.print();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The document could not be prepared for printing.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void print()}
        disabled={disabled || printing}
        className={`school-document-print-button ${className}`.trim()}
        data-testid={testId}
        title={disabled ? unavailableMessage : undefined}
      >
        <Printer size={15} />
        {printing ? 'Preparing…' : label}
      </button>
      {(failure || (disabled && unavailableMessage)) && (
        <p role="alert" className="school-document-error no-print">{failure || unavailableMessage}</p>
      )}
      <div ref={sourceRef} className="school-document-source" style={preview ? {display:'block',marginTop:'1rem'} : undefined} aria-hidden={preview ? undefined : true} data-testid={preview ? 'school-document-preview' : undefined}>
        {children}
      </div>
    </>
  );
}