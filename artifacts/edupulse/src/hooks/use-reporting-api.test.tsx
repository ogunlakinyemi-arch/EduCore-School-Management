import { describe, expect, it } from 'vitest';
import { catalogReports, isKnownReport, reportParams, reportSearch } from './use-reporting-api';

describe('reporting request contract', () => {
  it('retains only supplied filter values and safely encodes them', () => {
    expect(reportSearch({ status: ' verified & paid ', classId: '', dateFrom: '2026-03-01' }))
      .toBe('dateFrom=2026-03-01&status=verified+%26+paid');
  });

  it('accepts newly cataloged report slugs without a stale frontend allowlist', () => {
    const catalogIds = ['attendance-daily', 'attendance-weekly', 'attendance-monthly', 'attendance-term', 'report-card-summary', 'grade-distribution'];
    const catalog = { items: catalogIds.map(id => ({ id, title: id, filters: ['dateFrom'] })).concat([{ id: '../students', title: 'Unsafe', filters: [] }]) };
    expect(catalogReports(catalog).map(item => item.id)).toEqual(catalogIds);
    for (const id of catalogIds) expect(isKnownReport(id)).toBe(true);
    expect(isKnownReport('../students')).toBe(false);
    expect(isKnownReport('private/export')).toBe(false);
  });

  it('keeps tenant selection and page bounds in report and export parameters', () => {
    const school = { userId: 17, roleScope: 'SCHOOL_ADMIN', tenantId: 42, tenantSchoolId: 42 };
    expect(reportSearch(reportParams(school, { status: 'PRESENT' }, 50)))
      .toBe('limit=50&offset=50&schoolId=42&status=PRESENT');
    const parent = { userId: 18, roleScope: 'PARENT', tenantId: 0, tenantSchoolId: 0 };
    expect(reportParams(parent, {}, 0)).toEqual({ limit: '50', offset: '0' });
    const owner = { userId: 19, roleScope: 'PLATFORM_OWNER', tenantId: 0, tenantSchoolId: 0 };
    expect(reportParams(owner, { schoolId: '27' }, 100)).toEqual({ schoolId: '27', limit: '50', offset: '100' });
  });
});