// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

const { downloadPrintableNfcCard, useRegisterCard, useAssignEmployeeNfcCard } = vi.hoisted(() => ({
  downloadPrintableNfcCard: vi.fn(),
  useRegisterCard: vi.fn(),
  useAssignEmployeeNfcCard: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({ downloadPrintableNfcCard, useRegisterCard, useAssignEmployeeNfcCard }));
vi.mock('@/components/shared', () => ({
  Button: ({ children, testId, ...props }: any) => <button data-testid={testId} {...props}>{children}</button>,
}));

import { PrintableNfcCardDownload } from './printable-nfc-card-download';

let root: Root;
let host: HTMLDivElement;
const urlCreate = vi.fn(() => 'blob:printable-card');
const urlRevoke = vi.fn();
const anchorClick = vi.fn();
let savedFilename = '';

async function renderDownload(props: React.ComponentProps<typeof PrintableNfcCardDownload>) {
  await act(async () => root.render(<PrintableNfcCardDownload {...props} />));
}

describe('PrintableNfcCardDownload', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    downloadPrintableNfcCard.mockReset();
    useRegisterCard.mockReset();
    useAssignEmployeeNfcCard.mockReset();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: urlCreate });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: urlRevoke });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      savedFilename = this.download;
      anchorClick();
    });
    urlCreate.mockClear();
    urlRevoke.mockClear();
    anchorClick.mockClear();
    savedFilename = '';
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['student', 'STUDENT', 41, 'ACTIVE'],
    ['teacher', 'TEACHER', 52, 'ACTIVE'],
    ['payment-blocked teacher', 'TEACHER', 53, 'LOCKED'],
  ] as const)('downloads the assigned %s card by school and card ID', async (_kind, cardType, cardId, cardStatus) => {
    downloadPrintableNfcCard.mockResolvedValue(new Blob(['%PDF-test document'], { type: 'application/pdf' }));
    await renderDownload({ cardId, schoolId: 9, ownerAuthorized: true, cardType, cardStatus });
    const button = host.querySelector('button')!;
    expect(button.textContent).toContain('Download Printable ID Card');
    expect(host.textContent).toContain('CR80 front and back');

    vi.useFakeTimers();
    await act(async () => button.click());

    expect(downloadPrintableNfcCard).toHaveBeenCalledWith(cardId, { schoolId: 9 }, { responseType: 'blob' });
    expect(urlCreate).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(savedFilename).toBe(`nfc-card-${cardId}.pdf`);
    expect(urlRevoke).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(urlRevoke).toHaveBeenCalledWith('blob:printable-card');
    const anchor = host.ownerDocument.querySelector('a[download]');
    // The temporary link is removed once clicked; its filename excludes personal information.
    expect(anchor).toBeNull();
    expect(useRegisterCard).not.toHaveBeenCalled();
    expect(useAssignEmployeeNfcCard).not.toHaveBeenCalled();
  });

  it('shows API and invalid-file errors without saving a non-PDF response', async () => {
    downloadPrintableNfcCard.mockResolvedValue(new Blob(['not a PDF'], { type: 'text/plain' }));
    await renderDownload({ cardId: 61, schoolId: 9, ownerAuthorized: true, cardStatus: 'ACTIVE', cardType: 'STUDENT' });
    await act(async () => host.querySelector('button')?.click());

    expect(host.textContent).toContain('The server did not return a valid PDF file.');
    expect(urlCreate).not.toHaveBeenCalled();

    downloadPrintableNfcCard.mockRejectedValueOnce(new Error('Printable card unavailable'));
    await act(async () => host.querySelector('button')?.click());
    expect(host.textContent).toContain('Printable card unavailable');
  });

  it.each([
    ['non-owner', false, 'TEACHER', 'ACTIVE'],
    ['inactive student', true, 'STUDENT', 'LOCKED'],
    ['deactivated teacher', true, 'TEACHER', 'DEACTIVATED'],
    ['revoked teacher', true, 'TEACHER', 'REVOKED'],
    ['lost teacher', true, 'TEACHER', 'LOST'],
  ] as const)('hides downloads for %s', async (_reason, ownerAuthorized, cardType, cardStatus) => {
    await renderDownload({ cardId: 71, schoolId: 9, ownerAuthorized, cardType, cardStatus });
    expect(host.querySelector('button')).toBeNull();
    expect(downloadPrintableNfcCard).not.toHaveBeenCalled();
  });

  it('allows a teacher assignment in ASSIGNED status using the returned ID', async () => {
    downloadPrintableNfcCard.mockResolvedValue(new Blob(['%PDF-assigned'], { type: 'application/pdf' }));
    await renderDownload({ cardId: 88, schoolId: 9, ownerAuthorized: true, cardType: 'TEACHER', cardStatus: 'ASSIGNED' });
    await act(async () => host.querySelector('button')?.click());
    expect(downloadPrintableNfcCard).toHaveBeenCalledWith(88, { schoolId: 9 }, { responseType: 'blob' });
    expect(useRegisterCard).not.toHaveBeenCalled();
    expect(useAssignEmployeeNfcCard).not.toHaveBeenCalled();
  });

  it('downloads Staff through the same read-only official-card endpoint', async () => {
    downloadPrintableNfcCard.mockResolvedValue(new Blob(['%PDF-staff'], { type: 'application/pdf' }));
    await renderDownload({cardId:89,schoolId:9,ownerAuthorized:true,cardType:'STAFF',cardStatus:'LOCKED'});
    await act(async()=>host.querySelector('button')?.click());
    expect(downloadPrintableNfcCard).toHaveBeenCalledWith(89,{schoolId:9},{responseType:'blob'});
    expect(useRegisterCard).not.toHaveBeenCalled();
    expect(useAssignEmployeeNfcCard).not.toHaveBeenCalled();
  });
});