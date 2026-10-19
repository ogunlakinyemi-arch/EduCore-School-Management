import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shared = readFileSync(new URL('./shared.tsx', import.meta.url), 'utf8');
const partners = readFileSync(new URL('../pages/partner/management.tsx', import.meta.url), 'utf8');

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
});
