import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shared = readFileSync(new URL('./shared.tsx', import.meta.url), 'utf8');
const partners = readFileSync(new URL('../pages/partner/management.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../pages/dashboard.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

describe('shell and partners width containment', () => {
  it('keeps the 260px desktop sidebar and constrains the content column', () => {
    expect(shared).toContain('md:pl-[260px]');
    expect(shared).toContain('w-[260px]');
    expect(shared).toMatch(/flex min-h-\[100dvh\] w-full min-w-0 max-w-full flex-col md:pl-\[260px\]/);
    expect(shared).toMatch(/<main className="nav-grid w-full min-w-0 max-w-full/);
  });
  it('scrolls the partners table internally', () => {
    expect(partners).toContain('data-testid="partners-table-scroll"');
    expect(partners).toMatch(/overflow-x-auto/);
    expect(partners).toContain('min-w-[920px]');
  });
  it('allows the Owner dashboard columns to shrink instead of overflowing the sidebar-adjusted viewport', () => {
    expect(dashboard).toContain('owner-dashboard w-full min-w-0 max-w-full');
    expect(dashboard).toContain('xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]');
    expect(dashboard).toContain('2xl:grid-cols-3');
    expect(css).toContain('.owner-dashboard .grid > *');
    expect(css).toContain('overflow-wrap: anywhere');
  });
  it('stacks header controls until the desktop content area has room', () => {
    expect(shared).toContain('xl:h-[76px] xl:flex-row xl:items-center xl:justify-between');
    expect(shared).not.toContain('sm:h-[76px] sm:flex-row');
  });
});
