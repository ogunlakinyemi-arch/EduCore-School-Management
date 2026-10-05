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
  useReassignCard:vi.fn(),
  useListActivationDevices:vi.fn(),
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
  useReassignCard:mocks.useReassignCard,
  useListActivationDevices:mocks.useListActivationDevices,
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
    mocks.useReassignCard.mockReturnValue({isPending:false,mutate:vi.fn()});
    mocks.useListActivationDevices.mockReturnValue({data:[{id:501,serialNumber:'DEVICE-001'}],isSuccess:true,isFetching:false,isLoading:false,isError:false,refetch:vi.fn()});
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

  it('automatically displays every linked Device ID as read-only and never submits device IDs',async()=>{
    mocks.useListActivationDevices.mockReturnValue({data:[{id:501,serialNumber:'DEVICE-001'},{id:502,serialNumber:'DEVICE-002'}],isSuccess:true,isFetching:false});
    await linkExisting('STUDENT');
    const fields=Array.from(host.querySelectorAll('[data-testid="linked-nfc-devices"] input')) as HTMLInputElement[];
    expect(fields.map(field=>field.value)).toEqual(['DEVICE-001','DEVICE-002']);
    expect(fields.every(field=>field.readOnly)).toBe(true);
    expect(mocks.useListActivationDevices).toHaveBeenLastCalledWith(9,expect.objectContaining({
      query:expect.objectContaining({enabled:true,staleTime:0,refetchInterval:15000,queryKey:['owner-link-nfc-devices',9]}),
    }));
    expect(regMutate.mock.calls[0]![0].data).toEqual({uid:'ABCD1234',studentId:41});
  });

  it('blocks a school with no active device, including a forced form submit, and links to existing device management',async()=>{
    mocks.useListActivationDevices.mockReturnValue({data:[],isSuccess:true,isFetching:false});
    await linkExisting('STUDENT');
    expect(regMutate).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>('[data-testid="button-link-card"]')!.disabled).toBe(true);
    expect(host.textContent).toContain('This school has no active NFC device linked.');
    expect(host.textContent).toContain('Link NFC Device');
  });

  it('blocks assignment while the authoritative device list is loading or failed',async()=>{
    mocks.useListActivationDevices.mockReturnValue({data:undefined,isSuccess:false,isFetching:true,isLoading:true});
    await linkExisting('STUDENT');
    expect(regMutate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Loading linked NFC devices');
    mocks.useListActivationDevices.mockReturnValue({data:undefined,isSuccess:false,isFetching:false,isError:true,error:new Error('Device lookup failed'),refetch:vi.fn()});
    await act(async()=>root.render(<OwnerCardLink/>));
    expect(host.textContent).toContain('Device lookup failed');
    expect(host.querySelector<HTMLButtonElement>('[data-testid="button-link-card"]')!.disabled).toBe(true);
  });

  it('reuses an existing available school card instead of creating a duplicate UID',async()=>{
    const mutate=vi.fn();
    mocks.useReassignCard.mockReturnValue({isPending:false,mutate});
    mocks.useListCards.mockReturnValue({data:[{id:77,uid:'ABCD1234',studentId:null,status:'unassigned'}]});
    await linkExisting('STUDENT');
    expect(mutate).toHaveBeenCalledWith({cardId:77,data:{studentId:41}},expect.any(Object));
    expect(regMutate).not.toHaveBeenCalled();
  });

  it('changes the authoritative list and clears the selected person when switching schools',async()=>{
    mocks.useListOwnerSchoolDirectory.mockReturnValue({data:{schools:[{id:9,name:'North School'},{id:10,name:'South School'}]}});
    mocks.useListActivationDevices.mockImplementation((schoolId:number)=>({data:schoolId===9?[{id:501,serialNumber:'DEVICE-001'}]:[],isSuccess:true,isFetching:false}));
    await linkExisting('STUDENT');
    await changeValue(host.querySelector('[data-testid="select-link-school"]')!,'10');
    expect(host.textContent).not.toContain('DEVICE-001');
    expect(host.textContent).toContain('This school has no active NFC device linked.');
    expect(host.querySelector<HTMLSelectElement>('[data-testid="select-link-person"]')!.value).toBe('0');
    expect(host.querySelector<HTMLButtonElement>('[data-testid="button-link-card"]')!.disabled).toBe(true);
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