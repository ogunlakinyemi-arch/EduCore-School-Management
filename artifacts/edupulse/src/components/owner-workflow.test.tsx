import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildNavSections, navMode, ownerGroups } from './navigation-model';
import { GuidedSteps, groupReadiness, checkState, READINESS_GROUPS } from './owner-guided-steps';
import { broPrimaryNav, broSecondaryNav, visibleBroNav, isBroNavActive } from '@/pages/partner/bro-navigation';

const BACKEND_CODES = ['COLLECTION_ROLLOUT', 'MERCHANT_CONFIG', 'HTTPS_ENDPOINTS', 'SCHEMA', 'STUDENT_RULE', 'RECONCILIATION', 'NON_SPLIT_EVIDENCE', 'RUNTIME_SWITCH'];
const check = (code: string, status: string) => ({ code, label: code, status, detail: 'd' });

describe('BRO navigation compatibility', () => {
  it('keeps every existing /partners route reachable as primary or secondary', () => {
    const all = visibleBroNav([...broPrimaryNav, ...broSecondaryNav], { isOwner: true, dev: true }).map(i => i.href);
    expect(all.sort()).toEqual(['/partners', '/partners/conflicts', '/partners/field-operations', '/partners/finance', '/partners/live-readiness', '/partners/payouts', '/partners/term-commissions']);
    expect(broPrimaryNav.map(i => i.href)).toEqual(['/partners', '/partners/term-commissions', '/partners/finance', '/partners/payouts', '/partners/field-operations']);
  });
  it('keeps owner-only and dev-only gating', () => {
    const hrefs = visibleBroNav([...broPrimaryNav, ...broSecondaryNav], { isOwner: false, dev: false }).map(i => i.href);
    expect(hrefs).not.toContain('/partners/finance');
    expect(hrefs).not.toContain('/partners/live-readiness');
    expect(hrefs).toContain('/partners/conflicts');
  });
  it('treats partner detail as overview', () => {
    expect(isBroNavActive('/partners', '/partners/12')).toBe(true);
    expect(isBroNavActive('/partners', '/partners/payouts')).toBe(false);
  });
});

describe('Owner sidebar grouping', () => {
  it('groups owner links without dropping any', () => {
    expect(navMode(['PLATFORM_OWNER'], false, true)).toBe('owner');
    expect(navMode(['PLATFORM_OWNER'], true, true)).toBe('flat');
    const hrefs = [...ownerGroups.flatMap(g => g.hrefs), '/unlisted'];
    const out = buildNavSections(['/', ...hrefs], 'owner').flatMap(s => s.hrefs).sort();
    expect(out).toEqual([...hrefs].sort());
  });
});

describe('Readiness checklist truthfulness', () => {
  it('maps every backend check code exactly once', () => {
    const mapped = READINESS_GROUPS.flatMap(g => g.codes);
    expect([...mapped].sort()).toEqual([...BACKEND_CODES].sort());
  });
  it('REVIEW_REQUIRED and BLOCKED are never verified', () => {
    expect(checkState('REVIEW_REQUIRED')).toBe('open');
    expect(checkState('BLOCKED')).toBe('blocked');
    expect(checkState('READY')).toBe('done');
  });
  it('shows missing groups as not reported and legacy as not applicable', () => {
    const steps = groupReadiness([check('MERCHANT_CONFIG', 'READY'), check('RUNTIME_SWITCH', 'BLOCKED'), check('SCHEMA', 'READY')]);
    const by = Object.fromEntries(steps.map(s => [s.id, s.state]));
    expect(by.config).toBe('done');
    expect(by.release).toBe('blocked');
    expect(by.webhook).toBe('open');
    expect(by['legacy-split']).toBe('na');
    expect(by['legacy-hosted']).toBe('na');
    const html = renderToStaticMarkup(<GuidedSteps steps={steps} testId="g" label="x" />);
    expect(html).toContain('Not reported by the server');
    expect(html).toContain('Not applicable');
  });
  it('all-ready release still blocked if runtime switch blocked', () => {
    const steps = groupReadiness(BACKEND_CODES.map(c => check(c, c === 'RUNTIME_SWITCH' ? 'BLOCKED' : 'READY')));
    expect(steps.find(s => s.id === 'release')?.state).toBe('blocked');
  });
});
