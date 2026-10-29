import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Printer } from 'lucide-react';
import { getGetSchoolBrandingQueryKey, useGetSchoolBranding } from '@workspace/api-client-react';
import type { SchoolBranding } from '@workspace/api-client-react';

export type DocumentBranding = Partial<Pick<
  SchoolBranding,
  'schoolId' | 'name' | 'logoUrl' | 'address' | 'city' | 'state' | 'phone' | 'email' | 'website'
>> & { primaryColor?: string | null; secondaryColor?: string | null };

export function useSchoolDocumentBranding(schoolId: number) {
  return useGetSchoolBranding(schoolId, {
    query: {
      enabled: Number.isSafeInteger(schoolId) && schoolId > 0,
      queryKey: getGetSchoolBrandingQueryKey(schoolId),
    },
  });
}

/** Returns a same-origin path for the URL, or null when it points anywhere else. */
export function sameOriginUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
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
  const logoUrl = branding.logoUrl ? sameOriginUrl(branding.logoUrl) : null;
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
      {logoUrl && <img className="school-document-logo" data-print-required="logo" src={logoUrl} alt={`${branding.name || 'School'} logo`} />}
      <div className="school-document-identity">
        {branding.name && <h1>{branding.name}</h1>}
        {contact.map((value, index) => <div key={`${index}-${value}`}>{value}</div>)}
        {invalidLogoUrl && <p data-school-logo-invalid="true" className="school-document-error">The school logo URL is not same-origin and cannot be included in a secure printout.</p>}
      </div>
    </header>
  );
}

/* Self-contained print rules injected into the isolated print frame (A4, repeating table headers). */
export const SCHOOL_DOCUMENT_PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm 11mm 14mm; }
html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; color: #1b1d22 !important;
  height: auto !important; min-height: 0 !important; overflow: visible !important; visibility: visible !important; display: block !important;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body::before, body::after { content: none !important; display: none !important; }
.school-print-root, .school-print-root * { visibility: visible !important; }
.school-print-root { display: block !important; position: static !important; width: 100% !important; overflow: visible !important; }
.school-print-root [hidden] { display: none !important; }
.school-print-root .no-print { display: none !important; }
.school-document-page { box-sizing: border-box; width: 100%; max-width: 190mm; margin: 0 auto; padding: 0; background: #fff; color: #1b1d22; font-family: "Helvetica Neue", "Segoe UI", Arial, sans-serif; box-shadow: none !important; }
.school-document-table { display: table !important; width: 100%; border-collapse: collapse; overflow: visible !important; }
.school-document-table thead { display: table-header-group; }
.school-document-table tfoot { display: table-footer-group; }
.school-document-table tr, .school-document-field, .academic-report-block { break-inside: avoid; page-break-inside: avoid; }
.school-document-header, .academic-report-masthead { break-inside: avoid; page-break-inside: avoid; break-after: avoid; }
h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
img { max-width: 100%; }
`;

/** Builds a complete standalone HTML document for the print frame. Pure: safe to unit test. */
export function buildPrintableDocumentHtml({ bodyHtml, title, headStyles = '', baseHref }: { bodyHtml: string; title: string; headStyles?: string; baseHref?: string }) {
  const esc = (value: string) => value.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + (baseHref ? `<base href="${esc(baseHref)}">` : '')
    + `<title>${esc(title)}</title>${headStyles}<style data-school-print-css>${SCHOOL_DOCUMENT_PRINT_CSS}</style></head>`
    + `<body><main class="school-print-root" data-school-print-root="true">${bodyHtml}</main></body></html>`;
}

function collectHeadStyles(): string {
  return Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map(node => node.outerHTML)
    .join('');
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T) =>
  Promise.race([promise, new Promise<T>(resolve => window.setTimeout(() => resolve(fallback), ms))]);

function waitForImage(image: HTMLImageElement, ms: number): Promise<boolean> {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve(true);
  return withTimeout(new Promise<boolean>(resolve => {
    image.addEventListener('load', () => resolve(true), { once: true });
    image.addEventListener('error', () => resolve(false), { once: true });
    if (image.complete) resolve(image.naturalWidth > 0);
  }), ms, false);
}

/** Wait (bounded) for stylesheets, fonts and images inside the frame. Optional images that fail are removed; required ones throw. */
export async function settlePrintDocument(doc: Document, ms = 6000) {
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  await withTimeout(Promise.all(links.map(link => link.sheet ? Promise.resolve() : new Promise<void>(resolve => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
  }))), ms, undefined);
  const images = Array.from(doc.querySelectorAll('img'));
  const results = await Promise.all(images.map(image => waitForImage(image, ms)));
  images.forEach((image, index) => {
    if (results[index]) return;
    if (image.dataset.printRequired === 'logo') throw new Error('The school logo could not be loaded. Check access to school branding and try again.');
    const optional = image.closest('[data-print-optional]') ?? image;
    optional.remove();
  });
  const fonts = (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  if (fonts?.ready) await withTimeout(fonts.ready.then(() => undefined), Math.min(ms, 3000), undefined);
  await new Promise<void>(resolve => (doc.defaultView ?? window).requestAnimationFrame(() => resolve()));
  const root = doc.querySelector('[data-school-print-root]');
  if (!root || !(root.textContent ?? '').trim()) throw new Error('The document is empty and was not sent to the printer.');
}

/** Creates the isolated print frame synchronously. It is rendered off-screen but never display:none, so layout is real. */
export function createPrintFrame(html: string): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.title = 'Print preview';
  frame.dataset.schoolPrintFrame = 'true';
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '210mm', height: '297mm', border: '0', opacity: '0', pointerEvents: 'none', visibility: 'visible', display: 'block' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); throw new Error('The browser blocked the print surface. Try again.'); }
  doc.open();
  doc.write(html);
  doc.close();
  return frame;
}

export function SchoolDocumentPrintButton({
  children,
  label = 'Print',
  disabled = false,
  unavailableMessage,
  testId,
  className = '',
  preview = false,
  title,
}: {
  children: ReactNode;
  label?: string;
  disabled?: boolean;
  unavailableMessage?: string;
  testId?: string;
  className?: string;
  preview?: boolean;
  title?: string;
}) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [printing, setPrinting] = useState(false);
  const [failure, setFailure] = useState('');

  useEffect(() => () => { frameRef.current?.remove(); frameRef.current = null; }, []);

  const print = async () => {
    const source = sourceRef.current;
    if (!source || disabled || printing) return;
    setFailure('');
    setPrinting(true);
    frameRef.current?.remove();
    frameRef.current = null;
    let frame: HTMLIFrameElement | null = null;
    try {
      if (source.querySelector('[data-school-logo-invalid="true"]')) {
        throw new Error('The school logo URL is not same-origin. Update school branding before printing.');
      }
      // Synchronous from the click: build the isolated document before any await.
      const html = buildPrintableDocumentHtml({
        bodyHtml: source.innerHTML,
        title: title || label,
        headStyles: collectHeadStyles(),
        baseHref: window.location.href,
      });
      frame = createPrintFrame(html);
      frameRef.current = frame;
      const doc = frame.contentDocument!;
      await settlePrintDocument(doc);
      const win = frame.contentWindow;
      if (!win) throw new Error('The print surface closed before printing.');
      const printFrame = frame;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        win.removeEventListener('afterprint', cleanup);
        window.setTimeout(() => {
          printFrame.remove();
          if (frameRef.current === printFrame) frameRef.current = null;
        }, 500);
      };
      win.addEventListener('afterprint', cleanup);
      // Safety net only; normal cleanup happens after the print dialog closes.
      window.setTimeout(cleanup, 10 * 60_000);
      win.focus();
      win.print();
    } catch (error) {
      frame?.remove();
      if (frameRef.current === frame) frameRef.current = null;
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
        <p role="alert" className="school-document-error no-print" data-testid={testId ? `${testId}-error` : undefined}>{failure || unavailableMessage}</p>
      )}
      <div ref={sourceRef} className="school-document-source" style={preview ? {display:'block',marginTop:'1rem'} : undefined} aria-hidden={preview ? undefined : true} data-testid={preview ? 'school-document-preview' : undefined}>
        {children}
      </div>
    </>
  );
}
