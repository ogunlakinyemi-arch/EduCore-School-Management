// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect} from 'vitest';
import {SchoolDocumentPrintButton} from './school-document';

describe('school receipt preview',()=>{
  it('makes an explicitly requested preview accessible without printing',async()=>{
    const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
    await act(async()=>root.render(<SchoolDocumentPrintButton preview><article>Cash receipt · 04/10/2026 · payer · cashier</article></SchoolDocumentPrintButton>));
    const preview=host.querySelector<HTMLElement>('[data-testid="school-document-preview"]')!;
    expect(preview.style.display).toBe('block');expect(preview.hasAttribute('aria-hidden')).toBe(false);
    expect(preview.textContent).toContain('Cash receipt');
    await act(async()=>root.unmount());host.remove();
  });
  it('keeps other school print sources hidden by default',async()=>{
    const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
    await act(async()=>root.render(<SchoolDocumentPrintButton><article>Print-only document</article></SchoolDocumentPrintButton>));
    expect(host.querySelector('.school-document-source')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('[data-testid="school-document-preview"]')).toBeNull();
    await act(async()=>root.unmount());host.remove();
  });
});