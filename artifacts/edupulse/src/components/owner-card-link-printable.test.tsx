// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
  downloadPrintableNfcCard: vi.fn(),
  useListOwnerSchoolDirectory: vi.fn(),
  useListStudents: vi.fn(),
  useListEmployees: vi.fn(),
  useListEmployeeNfcCards: vi.fn(),
  useListCards: vi.fn(),
  useRegisterCard: vi.fn(),
  useAssignEmployeeNfcCard: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  downloadPrintableNfcCard: mocks.downloadPrintableNfcCard,
  useListOwnerSchoolDirectory: mocks.useListOwnerSchoolDirectory,
  useListStudents: mocks.useListStudents,
  useListEmployees: mocks.useListEmployees,
  useListEmployeeNfcCards: mocks.useListEmployeeNfcCards,
  useListCards: mocks.useListCards,
  useRegisterCard: mocks.useRegisterCard,
  useAssignEmployeeNfcCard: mocks.useAssignEmployeeNfcCard,
  getListCardsQueryKey: () => ['list-cards'],
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: mocks.useQueryClient }));
vi.mock('wouter', () => ({ Link: ({ children }: any) => <a>{children}</a> }));
vi.mock('@/components/shared', () => ({
  Button: ({ children, testId, ...props }: any) => <button data-testid={testId} {...props}>{children}</button>,
  Field: ({ label, children }: any) => <label>{label}{children}</label>,
  Info: () => null,
  StatusPill: ({ value }: any) => <span>{value}</span>,
}));

import { OwnerCardLink } from './owner-card-link';

let root: Root;
let host: HTMLDivElement;
const regMutate = vi.fn();
const assignMutate = vi.fn();
const clickAnchor = vi.fn();
let savedFilename = '';

async function changeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function linkExisting(type: 'STUDENT' | 'TEACHER') {
  await act(async () => root.render(<OwnerCardLink />));
  const initialSelects = [...host.querySelectorAll('select')];
  await changeValue(initialSelects[0], '9');
  const selects = [...host.querySelectorAll('select')];
  await changeValue(selects[1], type);
  await changeValue([...host.querySelectorAll('select')][2], String(type === 'STUDENT' ? 41 : 52));
  await changeValue(host.querySelector<HTMLInputElement>('[data-testid="input-link-uid"]')!, 'ABCD1234');
  await act(async () => {
    host.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid^="button-download-nfc-card-"]')?.click());
}

describe('OwnerCardLink printable card assignment result', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    regMutate.mockReset();
    assignMutate.mockReset();
    mocks.downloadPrintableNfcCard.mockReset().mockResolvedValue(new Blob(['%PDF-card'], { type: 'application/pdf' }));
    mocks.useQueryClient.mockReturnValue({ invalidateQueries: vi.fn() });
    mocks.useListOwnerSchoolDirectory.mockReturnValue({ data: { schools: [{ id: 9, name: 'North School' }] } });
    mocks.useListStudents.mockReturnValue({ data: [{ id: 41, firstName: 'Student', lastName: 'One', admissionNo: 'ADM41' }], isLoading: false, isError: false });
    mocks.useListEmployees.mockReturnValue({ data: [{ id: 52, firstName: 'Teacher', lastName: 'One', employeeId: 'EMP52', type: 'TEACHER' }], isLoading: false, isError: false });
    mocks.useListEmployeeNfcCards.mockReturnValue({ data: [] });
    mocks.useListCards.mockReturnValue({ data: [] });
    mocks.useRegisterCard.mockReturnValue({
      isPending: false,
      mutate: (...args: any[]) => regMutate(...args),
    });
    mocks.useAssignEmployeeNfcCard.mockReturnValue({
      isPending: false,
      mutate: (...args: any[]) => assignMutate(...args),
    });
    regMutate.mockImplementation((_variables: any, options: any) => options.onSuccess({ id: 101, status: 'locked', uid: 'ABCD1234' }));
    assignMutate.mockImplementation((_variables: any, options: any) => options.onSuccess({ cardId: 202, status: 'LOCKED' }));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:printable-card') });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      savedFilename = this.download;
      clickAnchor();
    });
    savedFilename = '';
    clickAnchor.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('does not offer a student print while its registration response is locked', async () => {
    await linkExisting('STUDENT');
    expect(regMutate).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-testid^="button-download-nfc-card-"]')).toBeNull();
    expect(mocks.downloadPrintableNfcCard).not.toHaveBeenCalled();
    expect(regMutate).toHaveBeenCalledOnce();
  });

  it('prints the assigned teacher card reported as payment-blocked LOCKED without another assignment', async () => {
    await linkExisting('TEACHER');
    expect(assignMutate).toHaveBeenCalledOnce();
    expect(mocks.downloadPrintableNfcCard).toHaveBeenCalledWith(202, { schoolId: 9 }, { responseType: 'blob' });
    expect(savedFilename).toBe('nfc-card-202.pdf');
    expect(assignMutate).toHaveBeenCalledOnce();
    expect(regMutate).not.toHaveBeenCalled();
  });
});