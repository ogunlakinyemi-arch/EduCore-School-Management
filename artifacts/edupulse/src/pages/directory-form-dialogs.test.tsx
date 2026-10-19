// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  manage: true, mutate: vi.fn(),
  rows: Array.from({length: 40}, (_, i) => ({
    id:i+1, name:`School ${i+1}`, firstName:`Student ${i+1}`, lastName:'Example',
    admissionNumber:`ADM-${i+1}`, code:`CODE-${i+1}`, status:'ACTIVE',
    className:'Class One', section:'A', gender:'MALE', dateOfBirth:'2014-01-01',
    createdAt:'2026-10-19', administrators:[], email:'fixture@example.test',
  })),
}));
vi.mock('@tanstack/react-query', async original => ({
  ...await original<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({data:{schools:fixture.rows, totals:{}},isLoading:false,isError:false}),
  useQueryClient: () => ({invalidateQueries:vi.fn().mockResolvedValue(undefined)}),
}));
vi.mock('@workspace/api-client-react', async original => ({
  ...await original<typeof import('@workspace/api-client-react')>(),
  useGetAuthorizedContext: () => ({data:{isPlatformOwner:false,roles:[{role:'SCHOOL_ADMIN',status:'ACTIVE',schoolId:1}]}}),
  useListStudents: () => ({data:fixture.rows}),
  useListSubjects: () => ({data:fixture.rows}),
  useListClasses: () => ({data:[]}),
  useListParents: () => ({data:[]}),
  useListStudentClassAssignments: () => ({data:[]}),
  useListClassSubjectAssignments: () => ({data:[]}),
  useGetSchool: () => ({data:{id:1,name:'School',status:'ACTIVE'}}),
  useCreateStudent: () => ({mutate:fixture.mutate}),
  useUpdateStudent: () => ({mutate:fixture.mutate}),
  useCreateSubject: () => ({mutate:fixture.mutate}),
  useUpdateSubject: () => ({mutate:fixture.mutate}),
  useAssignClassSubject: () => ({mutate:fixture.mutate}),
  useUpdateSchool: () => ({mutate:fixture.mutate}),
}));
vi.mock('@/components/shared', async original => ({
  ...await original<typeof import('@/components/shared')>(),
  useTenant: () => ({schoolId:1,setSchoolId:vi.fn()}),
  useSchoolAdminAccess: () => ({canManageSchool:fixture.manage}),
  TenantPicker: () => null,
}));
vi.mock('@/components/directory-export', () => ({DirectoryExport:()=>null}));
vi.mock('@/components/student-photo-field', () => ({StudentPhotoField:()=>null}));
import { SchoolsPage } from './schools';
import { StudentsPage } from './students';
import { SubjectsPage } from './subjects';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  fixture.manage=true; fixture.mutate.mockReset();
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

const click = async (element: Element | undefined | null) => {
  expect(element).toBeTruthy();
  await act(async()=>element!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
};
describe('real directory forms keep the existing handlers and open outside long lists',()=>{
  it.each([
    ['school edit', SchoolsPage, '[data-testid=button-edit-school-40]', 'Edit school profile'],
    ['school add', SchoolsPage, '[data-testid=button-add-school]', 'Add a new school'],
    ['student add', StudentsPage, '[data-testid=button-add-student]', 'Admit new student'],
    ['student edit', StudentsPage, '[data-testid=button-edit-student-40]', 'Edit student profile'],
    ['subject add', SubjectsPage, 'add-subject', 'Add Subject'],
    ['subject edit', SubjectsPage, 'edit-subject', 'Edit Subject'],
  ] as const)('%s is a body-level dialog and closes without saving',async(_name,Page,selector,title)=>{
    await act(async()=>root.render(<Page/>));
    const trigger=selector==='add-subject'
      ? [...host.querySelectorAll('button')].find(b=>b.textContent?.includes('Add subject'))
      : selector==='edit-subject'
        ? [...host.querySelectorAll('button')].filter(b=>b.textContent?.trim()==='Edit').at(-1)
        : host.querySelector(selector);
    await click(trigger);
    const dialog=document.body.querySelector('[role=dialog]')!;
    expect(dialog).not.toBeNull();
    expect(host.contains(dialog)).toBe(false);
    expect(dialog.textContent).toContain(title);
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(true);
    expect(dialog.querySelector('[data-testid=dialog-form-scroll]')).not.toBeNull();
    await click(dialog.querySelector('[data-testid=button-close-dialog]'));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(fixture.mutate).not.toHaveBeenCalled();
    expect(host.querySelectorAll('button').length).toBeGreaterThan(30);
  });
  it.each([StudentsPage,SubjectsPage])('does not add management actions for read-only users',async Page=>{
    fixture.manage=false;
    await act(async()=>root.render(<Page/>));
    expect(host.querySelector('[data-testid=button-add-student]')).toBeNull();
    expect([...host.querySelectorAll('button')].some(b=>/Add subject|^Edit$/.test(b.textContent?.trim()??''))).toBe(false);
  });
  it.each(['schools','students','subjects','classes','parents','employees'])('%s opts every existing shared modal into the reusable viewport fix',page=>{
    const source=readFileSync(`${process.cwd()}/src/pages/${page}.tsx`,'utf8');
    const openings=source.match(/<Modal\b[^>]*>/g)??[];
    expect(openings.length).toBeGreaterThan(0);
    for(const opening of openings) expect(opening).toMatch(/<Modal\s+viewport\b/);
  });
});
