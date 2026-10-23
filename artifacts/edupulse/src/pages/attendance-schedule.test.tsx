// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ schoolId: 7, context: {} as any, calls: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ useGetAuthorizedContext: () => state.context }));
vi.mock('@/components/shared', () => ({
  useTenant: () => ({ schoolId: state.schoolId }), TenantPicker: () => null,
  SkeletonPage: () => <div role="status">Loading</div>, PageHeading: ({ title }: any) => <h1>{title}</h1>,
}));
vi.mock('@/components/school-attendance-schedule', () => ({
  SchoolAttendanceSchedulePanel: (props: any) => { state.calls(props); return <div data-testid="schedule-form">{props.schoolId}</div>; },
}));
import { AttendanceSchedulePage } from './attendance-schedule';
let host: HTMLDivElement, root: Root;
const render = () => act(() => root.render(<AttendanceSchedulePage />));
const context = (role: string, schoolId = 7, owner = false, status = 'ACTIVE') => ({
  data: { isPlatformOwner: owner, roles: [{ role, schoolId, status }] }, isLoading: false,
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.schoolId = 7; state.context = context('SCHOOL_ADMIN'); state.calls.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
describe('independent attendance schedule entry', () => {
  it('loads the existing form for the selected authorized school, without report dependencies', () => {
    render(); expect(state.calls).toHaveBeenCalledWith({ schoolId: 7, canEdit: true });
    expect(host.textContent).toContain('Attendance schedule');
  });
  it.each(['TEACHER','STAFF','ACCOUNTANT','PARENT','STUDENT','PARTNER','DRIVER'])('does not mount the form for %s', role => {
    state.context = context(role); render(); expect(state.calls).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')).toBeTruthy();
  });
  it('refuses another school, inactive membership and an Owner even with School Admin membership', () => {
    for (const c of [context('SCHOOL_ADMIN',8),context('SCHOOL_ADMIN',7,false,'INACTIVE'),context('SCHOOL_ADMIN',7,true)]) {
      state.context = c; render(); expect(state.calls).not.toHaveBeenCalled();
    }
  });
  it('does not mount tenant settings before authorization finishes', () => {
    state.context = { isLoading: true }; render(); expect(state.calls).not.toHaveBeenCalled();
  });
  it('uses the selected school after a tenant switch', () => {
    render(); state.schoolId = 9; state.context = context('SCHOOL_ADMIN',9); render();
    expect(host.querySelector('[data-testid=schedule-form]')?.textContent).toBe('9');
  });
});
