import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ canManage: true, status: 'ACTIVE', mutate: vi.fn(), confirm: undefined as undefined | (() => void) }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@workspace/api-client-react', async importOriginal => {
  const actual = await importOriginal<any>();
  const mutation = () => ({ isPending: false, isError: false, mutate: vi.fn() });
  return {
    ...actual,
    useCreateParent: mutation, useUpdateParent: mutation,
    useCreateEmployee: mutation, useUpdateEmployee: mutation,
    useUpdateEmployeeStatus: () => ({ isPending: false, isError: false, mutate: state.mutate }),
    useListParents: () => ({ data: [{ id: 1, name: 'Example Parent' }] }),
    useListStudents: () => ({ data: [] }),
    useListEmployees: () => ({ data: [{ id: 2, firstName: 'Example', lastName: 'Teacher', status: state.status }] }),
  };
});
vi.mock('@/components/directory-export', () => ({ DirectoryExport: () => null }));
vi.mock('@/components/employee-photo-field', () => ({ EmployeePhotoField: () => <div>Private employee passport photo</div> }));
vi.mock('@/components/shared', () => ({
  useTenant: () => ({ schoolId: 1 }),
  useSchoolAdminAccess: () => ({ canManageSchool: state.canManage }),
  Field: ({ label, children }: any) => <label>{label}{children}</label>,
  Button: ({ children, testId, ...props }: any) => {
    if (String(children).startsWith('Confirm ')) state.confirm = props.onClick;
    return <button data-testid={testId} {...props}>{children}</button>;
  },
  PageHeading: ({ action }: any) => <header>{action}</header>,
  StatusPill: () => null, TenantPicker: () => null,
  cx: (...values: string[]) => values.filter(Boolean).join(' '),
}));
import { ParentForm, ParentsPage } from '@/pages/parents';
import { EmployeeForm, EmployeesPage, EmployeeStatusConfirmation } from '@/pages/employees';

beforeEach(() => { state.canManage = true; state.status = 'ACTIVE'; state.mutate.mockClear(); state.confirm = undefined; });
const props = { schoolId: 1, onDone: vi.fn(), onCancel: vi.fn() };
it.each(['PARENT','TEACHER','STAFF'])('%s create/edit forms have no title controls or migration warnings', type => {
  const Form = type === 'PARENT' ? ParentForm : EmployeeForm;
  for (const initial of [undefined,{id:1,type,name:'Example Parent',firstName:'Example',lastName:'Person'}]) {
    const html = renderToStaticMarkup(<Form {...props} initial={initial} />);
    expect(html).not.toMatch(/Person title|Title \(optional\)|No title|0168|migration|personTitle/);
    if (initial) expect(html).toContain(type === 'PARENT' ? 'value="Example Parent"' : 'value="Example"');
  }
});
it('preserves plain names and read-only Owner controls', () => {
  state.canManage = false;
  const parents = renderToStaticMarkup(<ParentsPage />);
  const employees = renderToStaticMarkup(<EmployeesPage />);
  expect(parents).toContain('Example Parent');
  expect(employees).toContain('Example Teacher');
  expect(parents).not.toContain('button-add-parent');
  expect(employees).not.toContain('button-add-employee');
  expect(employees).not.toContain('button-edit-employee');
  expect(employees).not.toContain('button-status-employee');
});
it.each(['ACTIVE', 'INACTIVE'])('exposes a confirmed %s status action to School Admin', status => {
  state.status = status;
  expect(renderToStaticMarkup(<EmployeesPage />)).toContain(status === 'ACTIVE' ? 'Deactivate' : 'Reactivate');
  const onDone = vi.fn();
  const html = renderToStaticMarkup(<EmployeeStatusConfirmation schoolId={1} employee={{ id: 2, firstName: 'Example', lastName: 'Teacher', status }} onDone={onDone} onCancel={vi.fn()} />);
  expect(html).toContain(status === 'ACTIVE' ? 'Historical records' : 'No new membership');
  state.confirm!();
  expect(state.mutate).toHaveBeenCalledWith({ employeeId: 2, params: { schoolId: 1 }, data: { status: status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } }, { onSuccess: onDone });
});
it.each(['SUSPENDED', 'RESIGNED', 'TERMINATED'])('does not offer one-click reactivation for %s', status => {
  state.status = status;
  expect(renderToStaticMarkup(<EmployeesPage />)).not.toContain('button-status-employee');
});
