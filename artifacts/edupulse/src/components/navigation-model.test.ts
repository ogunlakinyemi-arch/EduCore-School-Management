import { describe, expect, it } from 'vitest';
import { buildNavSections, navMode } from './navigation-model';

describe('navigation model', () => {
  it('keeps every authorized link exactly once', () => {
    const hrefs = ['/', '/students', '/library', '/unknown', '/settings-x'];
    const flat = buildNavSections(hrefs, 'admin').flatMap(s => s.hrefs).sort();
    expect(flat).toEqual(['/library', '/settings-x', '/students', '/unknown']);
  });
  it('does not add unauthorized links', () => {
    const s = buildNavSections(['/results'], 'teacher');
    expect(s.map(x => x.label)).toEqual(['Results']);
  });
  it('uses flat mode for restricted or other roles', () => {
    expect(navMode(['SCHOOL_ADMIN'], true)).toBe('flat');
    expect(navMode(['PARENT'], false)).toBe('flat');
    expect(navMode(['TEACHER'], false)).toBe('teacher');
    expect(navMode(['TEACHER', 'SCHOOL_ADMIN'], false)).toBe('admin');
  });
});
