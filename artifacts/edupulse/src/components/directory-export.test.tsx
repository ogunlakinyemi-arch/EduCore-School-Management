import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  schoolId: 10,
  auth: { isPlatformOwner: false, roles: [] as Array<{ role: string; status: string; schoolId: number }> },
}));
vi.mock('@workspace/api-client-react', () => ({ useGetAuthorizedContext: () => ({ data: state.auth }) }));
vi.mock('@/components/shared', () => ({
  useTenant: () => ({ schoolId: state.schoolId }),
  Button: ({ children, disabled }: any) => <button disabled={disabled}>{children}</button>,
}));
import { DirectoryExport } from './directory-export';

beforeEach(() => { state.schoolId = 10; state.auth = { isPlatformOwner: false, roles: [] }; });

describe('directory export controls', () => {
  it.each(['TEACHER', 'STAFF', 'ACCOUNTANT', 'PARENT', 'STUDENT', 'PARTNER'])('hides controls for %s', role => {
    state.auth.roles = [{ role, status: 'ACTIVE', schoolId: 10 }];
    expect(renderToStaticMarkup(<DirectoryExport kind="students" />)).toBe('');
  });
  it('requires a matching active School Admin role', () => {
    state.auth.roles = [{ role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 20 }];
    expect(renderToStaticMarkup(<DirectoryExport kind="parents" />)).toBe('');
    state.auth.roles = [{ role: 'SCHOOL_ADMIN', status: 'INACTIVE', schoolId: 10 }];
    expect(renderToStaticMarkup(<DirectoryExport kind="parents" />)).toBe('');
    state.auth.roles[0]!.status = 'ACTIVE';
    const html = renderToStaticMarkup(<DirectoryExport kind="parents" />);
    expect(html).toContain('Excel: parents');
    expect(html).toContain('200 records per file');
    expect(html).toContain('no search filter');
  });
  it('supports Owner read-only export and disables download without a school', () => {
    state.auth.isPlatformOwner = true;
    state.schoolId = 0;
    expect(renderToStaticMarkup(<DirectoryExport kind="teachers" />)).toContain('disabled');
  });
});
