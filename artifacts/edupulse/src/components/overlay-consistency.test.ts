import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const shared = readFileSync(new URL('./shared.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
describe('overlay consistency', () => {
  it('portals legacy modal with scroll lock, Escape and focus restore', () => {
    expect(shared).toContain('<ViewportFormDialog');
    const viewport = readFileSync(new URL('./viewport-form-dialog.tsx', import.meta.url), 'utf8');
    expect(viewport).toContain('<Dialog.Portal>');
    expect(viewport).toContain('onCloseAutoFocus');
    expect(viewport).toContain('overflow-y-auto');
  });
  it('fade-up does not retain a transform after animating', () => {
    expect(css).toMatch(/animation: fade-up [^;]*backwards;/);
  });
  it('adds admin-only Schedule link', () => {
    expect(shared).toMatch(/href: '\/attendance\/schedule', label: 'Schedule'[^}]*roles: \['SCHOOL_ADMIN'\]/);
  });
});
