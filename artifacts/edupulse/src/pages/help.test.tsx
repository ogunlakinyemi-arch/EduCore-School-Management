// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import appSource from '../App.tsx?raw';
import partnerSource from './partner/portal.tsx?raw';
import sharedSource from '../components/shared.tsx?raw';
import manualSource from './help-manual.tsx?raw';
import { readFileSync } from 'node:fs';
import { HelpLink } from '@/components/help-link';
import { helpFaqs, helpManuals } from '@/lib/help-content';
import { HelpRoutes } from './help-routes';

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount(path = '/help', base = '') {
  const location = memoryLocation({ path, record: true });
  await act(async () => root.render(<Router hook={location.hook} base={base}><HelpLink /><HelpRoutes /></Router>));
  return location;
}
const get = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const click = async (node: HTMLElement) => act(async () => node.click());
const search = async (text: string) => act(async () => {
  const input = get('input-help-search') as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('public Help Centre navigation and source-reviewed content', () => {
  it('offers all three guides and a working shared help entry', async () => {
    await mount();
    expect(get('link-help-centre').getAttribute('href')).toBe('/help');
    for (const manual of helpManuals) {
      expect(get(`link-manual-${manual.id}`).getAttribute('href')).toBe(`/help/manuals/${manual.id}`);
      expect(get(`section-guide-${manual.id}`).textContent).toContain(manual.title);
    }
    expect(host.textContent).toContain('does not change what you can access');
  });
  it('filters by role, searches section body and FAQs, and resets empty results', async () => {
    await mount();
    await click(get('button-role-teachers-staff'));
    expect(get('button-role-teachers-staff').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-testid="section-guide-schools"]')).toBeNull();
    await search('payslips');
    expect(host.textContent).toContain('contact the school payroll administrator');
    expect(host.querySelector('[aria-expanded="true"]')).not.toBeNull();
    await search('zzz-no-such-guide');
    expect(get('empty-help').textContent).toContain('Nothing matches');
    await click(get('button-reset-help'));
    expect(get('button-role-all').getAttribute('aria-pressed')).toBe('true');
    expect(get('section-guide-partners')).not.toBeNull();
    await search('directory is unavailable');
    expect(get('section-faqs').textContent).toContain('Do not enter a free-text bank or guess a code');
  });
  it('opens and closes instructional sections with accessible button controls', async () => {
    await mount();
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(b => b.textContent?.includes('Import existing records'))!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-controls')!)?.textContent).toContain('preview');
    await click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
  it('keeps guide links inside an artifact base path and navigates to the manual', async () => {
    await mount('/school-app/help', '/school-app');
    expect(get('link-help-centre').getAttribute('href')).toBe('/school-app/help');
    expect(get('link-manual-partners').getAttribute('href')).toBe('/school-app/help/manuals/partners');
    await click(get('link-manual-partners'));
    expect(get('help-manual').textContent).toContain('Business Relationship Officer (BRO) setup manual');
  });
  it('has only implemented internal destinations and installs help before protected fallbacks', () => {
    const app = appSource;
    const partner = partnerSource;
    const shared = sharedSource;
    const paths = [...(app + partner).matchAll(/<Route path="([^"]+)"/g)].map(m => m[1].replace(/\/\*\?$/, ''));
    for (const link of helpManuals.flatMap(m => m.sections.flatMap(s => s.links ?? []))) {
      expect(paths, `Missing implemented route for ${link.href}`).toContain(link.href);
      expect(link.href).not.toMatch(/^(https?:|mailto:)/);
    }
    expect(app.indexOf('<Route path="/help"')).toBeLessThan(app.indexOf('<AuthGuard>'));
    expect(shared).toContain('<HelpLink');
    expect(partner).toContain('<HelpLink');
  });
  it('retains explicit scope, financial safety and support privacy instructions', () => {
    const all = JSON.stringify({ helpManuals, helpFaqs });
    for (const phrase of ['Platform Owner approval', 'not a public Teacher/Staff application',
      'not a guarantee', 'not proof', 'TEST', 'LIVE_VERIFIED', 'reconciliation',
      'verification code', 'Crop or redact', 'No public support phone number'])
      expect(all + manualSource).toContain(phrase);
  });
});

describe('complete printable manuals and print-to-PDF flow', () => {
  it.each(helpManuals)('prints $id without filtering or losing collapsed content', async manual => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await mount(`/help/manuals/${manual.id}`);
    expect(document.title).toBe(`Yetenia EduCore — ${manual.title}`);
    for (const section of manual.sections) {
      expect(document.getElementById(section.id)).not.toBeNull();
      for (const step of section.steps) expect(host.textContent).toContain(step);
    }
    expect(host.querySelector('[hidden]')).toBeNull();
    expect(host.textContent).toContain('does not download a PDF automatically');
    expect(host.textContent).toContain('Share → Print');
    await click(get('button-print-manual'));
    expect(print).toHaveBeenCalledTimes(1);
    expect(host.querySelector('h1')?.textContent).toBe(manual.title);
  });
  it('provides a safe recovery for missing or unknown manual paths', async () => {
    await mount('/help/manuals/nonexistent');
    expect(host.textContent).toContain('Manual not found');
    expect(host.querySelector('[data-testid="button-print-manual"]')).toBeNull();
    const back = Array.from(host.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent === 'Return to Help Centre')!;
    await click(back);
    expect(get('heading-help-centre')).not.toBeNull();
  });
  it('has a dedicated A4 print layout that hides only the controls, not the manual', () => {
    const css = readFileSync('src/pages/help-manual.css', 'utf8');
    expect(css).toContain('@media print');
    expect(css).toContain('size: A4');
    expect(css).toContain('.help-no-print { display: none');
    expect(css).toContain('break-inside: avoid');
    expect(css).not.toMatch(/\.help-manual\s*\{[^}]*display:\s*none/);
  });
});
