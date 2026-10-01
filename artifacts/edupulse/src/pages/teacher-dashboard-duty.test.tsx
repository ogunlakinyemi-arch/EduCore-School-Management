import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as Array<{ schoolId: number; enabled?: boolean }>);
vi.mock('wouter', () => ({ Link: ({ children, href }: any) => <a href={href}>{children}</a> }));
vi.mock('@workspace/api-client-react', () => ({
  useListSchoolTeacherAssignments: (schoolId: number, _p: any, o: any) => {
    calls.push({ schoolId, enabled: o.query.enabled });
    return { data: [{ id: 1, className: 'JSS 2', section: 'B', subjectName: 'Biology' }], isLoading: false, isError: false, refetch: vi.fn() };
  },
  getListSchoolTeacherAssignmentsQueryKey: () => ['k'],
}));

import { TeacherAssignedWork, isOwnTeacherView } from '@/components/teacher-assigned-work';
import { classifyDuty, dutyViewParams } from './teacher-duty';

describe('teacher dashboard widget', () => {
  it('renders own classes and subjects with links', () => {
    const html = renderToStaticMarkup(<TeacherAssignedWork schoolId={5} />);
    expect(html).toContain('JSS 2 B');
    expect(html).toContain('Biology');
    expect(html).toContain('href="/teacher-assignments"');
    expect(calls[0]).toEqual({ schoolId: 5, enabled: true });
  });
});

describe('duty views', () => {
  const t = '2025-10-10';
  it('classifies by dates and status', () => {
    expect(classifyDuty({ startDate: '2025-10-06', endDate: '2025-10-10', status: 'ACTIVE' }, t)).toBe('current');
    expect(classifyDuty({ startDate: '2025-10-13', endDate: '2025-10-17', status: 'ACTIVE' }, t)).toBe('upcoming');
    expect(classifyDuty({ startDate: '2025-10-01', endDate: '2025-10-05', status: 'ACTIVE' }, t)).toBe('history');
    expect(classifyDuty({ startDate: '2025-10-06', endDate: '2025-10-17', status: 'INACTIVE' }, t)).toBe('history');
  });
  it('selects bounded queries; history does not filter to ACTIVE only', () => {
    expect(dutyViewParams('upcoming', t)).toEqual([{ status: 'ACTIVE', startsOnOrAfter: '2025-10-11' }]);
    expect(dutyViewParams('history', t)).toEqual([{ status: 'all', endsOnOrBefore: '2025-10-09' }, { status: 'INACTIVE' }]);
    expect(dutyViewParams('all', t, 'all')).toEqual([{ status: 'all' }]);
  });
});

describe('widget gating', () => {
  const r = (role: string) => ({ role, status: 'ACTIVE', schoolId: 5 });
  it('only active teachers of the selected school', () => {
    expect(isOwnTeacherView({ roles: [r('TEACHER')] }, 5)).toBe(true);
    expect(isOwnTeacherView({ roles: [r('PARENT')] }, 5)).toBe(false);
    expect(isOwnTeacherView({ isPlatformOwner: true, roles: [r('TEACHER')] }, 5)).toBe(false);
    expect(isOwnTeacherView({ roles: [r('TEACHER'), r('SCHOOL_ADMIN')] }, 5)).toBe(false);
    expect(isOwnTeacherView({ roles: [{ ...r('TEACHER'), schoolId: 9 }] }, 5)).toBe(false);
  });
});
