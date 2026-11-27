import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ sessions: vi.fn(), terms: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  listAcademicSessions: api.sessions, listAcademicTerms: api.terms,
}));
import { readSchoolSubscriptionTerms } from './school-subscription-terms';
beforeEach(() => { vi.resetAllMocks(); });
it('retrieves all saved school sessions, including historical terms, with explicit school scope', async () => {
  api.sessions.mockResolvedValue([
    { id: 11, schoolId: 1, name: 'Earlier session', status: 'ARCHIVED' },
    { id: 12, schoolId: 1, name: 'Current session' },
    { id: 21, schoolId: 2, name: 'Other school' },
  ]);
  api.terms.mockImplementation(async (id: number) => [
    { id: id * 10, sessionId: id, name: 'First term' },
    { id: 999, sessionId: 21, name: 'Wrong session' },
  ]);
  const controller = new AbortController();
  const rows = await readSchoolSubscriptionTerms(1, controller.signal);
  expect(api.sessions).toHaveBeenCalledWith({ schoolId: 1, status: 'all' }, { signal: controller.signal });
  expect(api.terms.mock.calls).toEqual([
    [11, { schoolId: 1 }, { signal: controller.signal }],
    [12, { schoolId: 1 }, { signal: controller.signal }],
  ]);
  expect(rows.map(t => [t.id, t.sessionName])).toEqual([[110, 'Earlier session'], [120, 'Current session']]);
});
it('returns an honest empty list without guessing another school or inventing terms', async () => {
  api.sessions.mockResolvedValue([{ id: 21, schoolId: 2 }]);
  expect(await readSchoolSubscriptionTerms(1)).toEqual([]);
  expect(api.terms).not.toHaveBeenCalled();
});
it('supports saved sessions with no terms', async () => {
  api.sessions.mockResolvedValue([{ id: 11, schoolId: 1 }]);
  api.terms.mockResolvedValue([]);
  expect(await readSchoolSubscriptionTerms(1)).toEqual([]);
});
it('propagates permission and retrieval errors rather than presenting partial or empty success', async () => {
  api.sessions.mockRejectedValueOnce(Error('denied'));
  await expect(readSchoolSubscriptionTerms(1)).rejects.toThrow('denied');
  api.sessions.mockResolvedValue([{ id: 11, schoolId: 1 }]);
  api.terms.mockRejectedValueOnce(Error('unavailable'));
  await expect(readSchoolSubscriptionTerms(1)).rejects.toThrow('unavailable');
});
