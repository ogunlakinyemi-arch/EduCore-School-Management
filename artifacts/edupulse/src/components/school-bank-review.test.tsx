// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ review: vi.fn(), profile: {} as any }));
vi.mock('@workspace/api-client-react', async original => ({
  ...await original<typeof import('@workspace/api-client-react')>(),
  reviewPlatformSchoolSettlement: f.review,
  useGetPlatformSchoolSettlement: () => ({ data: f.profile, isLoading: false, isError: false, refetch: vi.fn() }),
}));
import { SchoolBankReview } from './school-bank-review';
let root: ReturnType<typeof createRoot>, host: HTMLDivElement, client: QueryClient;
const query = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const click = (id: string) => act(async () => query(id).click());
async function enter(id: string, value: string) {
  await act(async () => {
    const node = query(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype :
      node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><SchoolBankReview schoolId={7} schoolName="Fictional School" onClose={vi.fn()} /></QueryClientProvider>));
}
async function completeEvidence() {
  await enter('review-evidence', 'a'.repeat(64));
  await enter('review-note', 'Independent fixture bank statement and school beneficiary authority reviewed.');
  await click('review-confirm');
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  f.profile = { schoolId: 7, schoolName: 'Fictional School', businessName: 'Fictional School Business',
    accountName: 'Fixture Holder', bankName: 'Fictional Bank', accountLast4: '0002',
    reviewSnapshot: 'b'.repeat(64), status: 'PENDING_VERIFICATION' };
  f.review.mockReset().mockResolvedValue({ ...f.profile, status: 'VERIFIED' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Network forbidden in component tests'); }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); client.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
it("shows masked submitted details and explains that merchant activation is not bank evidence", () => {
  expect(query('review-bank-profile').textContent).toContain('Ending 0002');
  expect(document.body.textContent).toContain('does not verify this school');
  expect((query('button-save-bank-review') as HTMLButtonElement).disabled).toBe(true);
  expect(f.review).not.toHaveBeenCalled();
});
it("requires independent evidence, a fresh confirmation, a note and deliberate confirmation before verification", async () => {
  await enter('review-note', 'Reviewed the independent account evidence for this school.');
  expect((query('button-save-bank-review') as HTMLButtonElement).disabled).toBe(true);
  await completeEvidence(); await click('button-save-bank-review');
  expect(f.review).toHaveBeenCalledWith(7, expect.objectContaining({
    decision: 'VERIFY', expectedSnapshot: 'b'.repeat(64), evidenceSha256: 'a'.repeat(64), independentAccountMatchConfirmed: true,
  }), { headers: { 'Idempotency-Key': expect.any(String) } });
  expect(document.body.textContent).toContain('verification recorded with an audit trail');
});
it("records rejection with a reason but without claiming independent verification", async () => {
  await enter('review-decision', 'REJECT');
  await enter('review-note', 'The school must provide corrected beneficiary ownership evidence.');
  f.review.mockResolvedValue({ ...f.profile, status: 'ACTION_REQUIRED' });
  await click('button-save-bank-review');
  expect(f.review.mock.calls[0][1]).not.toHaveProperty('evidenceSha256');
  expect(f.review.mock.calls[0][1].decision).toBe('REJECT');
  expect(document.body.textContent).toContain('Rejection recorded');
});
it("makes no request if the Owner cancels the final confirmation", async () => {
  await completeEvidence(); vi.mocked(window.confirm).mockReturnValue(false);
  await click('button-save-bank-review'); expect(f.review).not.toHaveBeenCalled();
});
it("reuses the same review key after an uncertain response", async () => {
  f.review.mockRejectedValueOnce(Error('Lost response'));
  await completeEvidence(); await click('button-save-bank-review');
  expect(document.body.textContent).toContain('could not be confirmed');
  await click('button-save-bank-review');
  expect(f.review.mock.calls[0][2]).toEqual(f.review.mock.calls[1][2]);
});
it("does not carry an old evidence confirmation onto a refreshed bank snapshot", async () => {
  await completeEvidence(); f.profile = { ...f.profile, reviewSnapshot: 'c'.repeat(64) }; await render();
  expect((query('button-save-bank-review') as HTMLButtonElement).disabled).toBe(true);
  expect((query('review-confirm') as HTMLInputElement).checked).toBe(false);
});
it("explains an unavailable API review version and prevents writes", async () => {
  f.profile = { ...f.profile, reviewSnapshot: undefined }; await render();
  expect(document.body.textContent).toContain('updated API must be deployed');
  expect((query('button-save-bank-review') as HTMLButtonElement).disabled).toBe(true);
});
