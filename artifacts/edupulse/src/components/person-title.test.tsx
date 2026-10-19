import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ canManage: true, error: null as unknown }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@workspace/api-client-react', async importOriginal => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  const mutation = () => ({ isPending: false, isError: !!state.error, error: state.error, mutate: vi.fn() });
  return {
    ...actual,
    useCreateParent: mutation, useUpdateParent: mutation,
    useCreateEmployee: mutation, useUpdateEmployee: mutation,
    useListParents: () => ({ data: [{ id: 1, name: 'Example Parent', personTitle: 'Dr' }] }),
    useListStudents: () => ({ data: [] }),
    useListEmployees: () => ({ data: [{ id: 2, firstName: 'Example', lastName: 'Teacher', personTitle: 'Prof' }] }),
  };
});
vi.mock('@/components/directory-export', () => ({ DirectoryExport: () => null }));
vi.mock('@/components/shared', () => ({
  useTenant: () => ({ schoolId: 1 }),
  useSchoolAdminAccess: () => ({ canManageSchool: state.canManage }),
  Field: ({ label, children }: any) => <label>{label}{children}</label>,
  Button: ({ children, testId, ...props }: any) => <button data-testid={testId} {...props}>{children}</button>,
  PageHeading: ({ action }: any) => <header>{action}</header>,
  StatusPill: () => null, TenantPicker: () => null,
  cx: (...values: string[]) => values.filter(Boolean).join(' '),
}));
import { PersonTitleField, personDisplayName } from './person-title';
import { ParentForm, ParentsPage } from '@/pages/parents';
import { EmployeeForm, EmployeesPage } from '@/pages/employees';

beforeEach(() => { state.canManage = true; state.error = null; });
const props = { schoolId: 1, onDone: vi.fn(), onCancel: vi.fn() };

describe('person titles in school profiles', () => {
  it('explains the migration requirement before a save and preserves the no-title option', () => {
    for (const Form of [ParentForm, EmployeeForm]) {
      const html = renderToStaticMarkup(<Form {...props} />);
      expect(html).toContain('0168_person_titles.sql');
      expect(html).toContain('choose <strong>No title</strong> to save other details');
      expect(html).toContain('server rejects the save without changing the record');
      expect(html).toMatch(/value="" selected/);
    }
  });
  it('has an explicit no-title option and sends null when cleared', () => {
    const onChange = vi.fn();
    const element = PersonTitleField({ value: 'Dr', onChange });
    element.props.children[0].props.onChange({ target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
    const html = renderToStaticMarkup(element);
    expect(html).toContain('No title');
    expect(html).toMatch(/value="Dr" selected/);
  });
  it('keeps the title separate from legacy and missing names', () => {
    expect(personDisplayName(null, 'Legacy Name')).toBe('Legacy Name');
    expect(personDisplayName('Dr', 'Example', null, 'Teacher')).toBe('Dr Example Teacher');
  });
  it('initializes parent create/edit forms from the current title without changing the name', () => {
    const create = renderToStaticMarkup(<ParentForm {...props} />);
    expect(create).toContain('Person title');
    expect(create).toMatch(/value="" selected/);
    const edit = renderToStaticMarkup(<ParentForm {...props} initial={{ id: 1, name: 'Example Parent', personTitle: 'Mrs' }} />);
    expect(edit).toMatch(/value="Mrs" selected/);
    expect(edit).toContain('value="Example Parent"');
  });
  it.each(['TEACHER', 'STAFF'])('initializes %s create/edit forms with title controls', type => {
    expect(renderToStaticMarkup(<EmployeeForm {...props} />)).toContain('Person title');
    const html = renderToStaticMarkup(<EmployeeForm {...props} initial={{ id: 1, type, firstName: 'Example', lastName: 'Person', personTitle: 'Chief' }} />);
    expect(html).toMatch(/value="Chief" selected/);
    expect(html).toContain('value="Example"');
  });
  it('shows the missing-migration explanation instead of a generic save failure', () => {
    state.error = { data: { error: 'Saving person titles requires the reviewed person-title database migration. No record was changed.' } };
    for (const Form of [ParentForm, EmployeeForm]) {
      const html = renderToStaticMarkup(<Form {...props} />);
      expect(html).toContain('role="alert"');
      expect(html).toContain('No record was changed');
    }
  });
  it('shows titles to read-only Owner without offering school mutations', () => {
    state.canManage = false;
    const parents = renderToStaticMarkup(<ParentsPage />);
    const employees = renderToStaticMarkup(<EmployeesPage />);
    expect(parents).toContain('Dr Example Parent');
    expect(employees).toContain('Prof Example Teacher');
    expect(parents).not.toContain('button-add-parent');
    expect(employees).not.toContain('button-add-employee');
    expect(employees).not.toContain('button-edit-employee');
  });
});
