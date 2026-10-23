import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

// Route and real authorization checks, with only transport authentication and
// PostgreSQL replaced. These tests never connect to an environment database.
const fixture = vi.hoisted(() => ({
  context: {} as any, schedules: new Map<number, any>(), writes: 0, reads: [] as string[],
}));
vi.mock('@workspace/db', () => {
  const query = async (sql: string, values: any[] = []) => {
    if (/SELECT[\s\S]*FROM audit_logs/i.test(sql)) {
      fixture.reads.push(sql);
      // audit_logs uses "timestamp", not created_at. The previous permissive
      // mock hid the exact undefined-column error seen by the real endpoint.
      if (/\bcreated_at\b/i.test(sql)) {
        throw Object.assign(new Error('column "created_at" does not exist'), { code: '42703' });
      }
      const schoolId = values.find(value => typeof value === 'number');
      const saved = typeof schoolId === 'number' ? fixture.schedules.get(schoolId) : undefined;
      return { rows: saved ? [{ metadata: structuredClone(saved), effectiveAt: '2026-10-23T08:00:00Z' }] : [] };
    }
    if (/INSERT INTO audit_logs/i.test(sql)) {
      fixture.schedules.set(values[1], JSON.parse(values[4])); fixture.writes++;
    }
    return { rows: [] };
  };
  return { pool: { query, connect: async () => ({ query, release() {} }) } };
});
vi.mock('../middlewares/auth', async importOriginal => ({
  ...await importOriginal<typeof import('../middlewares/auth')>(),
  requireAuthentication: () => (req: any, _res: any, next: any) => {
    req.edupulseUser = fixture.context; next();
  },
}));
vi.mock('../services/attendance-assessment', () => ({ assessAttendanceDay: vi.fn() }));
import { createAttendanceScheduleRouter } from './attendance-schedule';
import { defaultAttendanceSchedule } from '../services/attendance-schedule';

let server: Server, base: string;
const membership = (role = 'SCHOOL_ADMIN', schoolId: number | null = 7, status = 'ACTIVE') => ({ role, schoolId, status });
const request = (method: string, schoolId = 7, data?: unknown) => fetch(`${base}/school/attendance/schedule?schoolId=${schoolId}`, {
  method, headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}),
});
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use(createAttendanceScheduleRouter(vi.fn()));
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? error.statusCode ?? 500).json({ error: error.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
  fixture.schedules.clear(); fixture.writes = 0; fixture.reads = [];
  fixture.context = { user: { id: 71, firstName: 'Development', lastName: 'Fixture' }, roles: [membership()] };
});
describe('existing attendance schedule API contract', () => {
  it('reads the established audit timestamp column for an existing schedule', async () => {
    fixture.schedules.set(7, { revision: 3, schedule: { ...structuredClone(defaultAttendanceSchedule), fridayClosing: '12:30' } });
    fixture.schedules.set(8, { revision: 99, schedule: structuredClone(defaultAttendanceSchedule) });
    const response = await request('GET');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 3, effectiveAt: '2026-10-23T08:00:00.000Z', schedule: { fridayClosing: '12:30' } });
    expect(fixture.reads[0]).toContain('"timestamp" AS "effectiveAt"');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('returns unsaved defaults with no effective timestamp when this school has no schedule', async () => {
    fixture.schedules.set(8, { revision: 99, schedule: structuredClone(defaultAttendanceSchedule) });
    const response = await request('GET');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 0, effectiveAt: null, schedule: defaultAttendanceSchedule });
    expect(fixture.writes).toBe(0);
  });
  it('rejects unauthorized tenant/role reads before querying schedule data', async () => {
    for (const roles of [[membership('SCHOOL_ADMIN',8)],[membership('SCHOOL_ADMIN',7,'INACTIVE')],[membership('PARENT')]]) {
      fixture.context.roles = roles;
      expect((await request('GET')).status).toBe(404);
    }
    expect(fixture.reads).toEqual([]);
  });
  it('rejects missing school scope without reading another tenant', async () => {
    expect((await fetch(`${base}/school/attendance/schedule`)).status).toBe(400);
    expect(fixture.reads).toEqual([]);
  });
  it('returns an explicit review error instead of overwriting a corrupt saved schedule', async () => {
    fixture.schedules.set(7, { revision: 1, schedule: {} });
    const response = await request('GET');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Saved attendance schedule is invalid; administrator review required' });
    expect(fixture.writes).toBe(0);
  });
  it('saves and reloads closing/review times for the authorized school only', async () => {
    const initial = await (await request('GET')).json() as { revision: number };
    const schedule = { ...structuredClone(defaultAttendanceSchedule),
      weekdaysClosing:'15:00',fridayClosing:'12:30',missingTagOutStart:'15:15',missingTagOutEnd:'17:00',fridayMissingTagOut:'13:30' };
    const response = await request('PUT',7,{revision:initial.revision,schedule,reason:'Reviewed closing times'});
    expect(response.status).toBe(200);
    const saved = await response.json(); expect(saved).toMatchObject({revision:1,schedule});
    expect(await (await request('GET')).json()).toMatchObject(saved);
    expect(fixture.schedules.has(8)).toBe(false);
    const conflict = await request('PUT',7,{revision:0,schedule,reason:'Stale revision'});
    expect(conflict.status).toBe(409); expect(fixture.writes).toBe(1);
  });
  it.each(['TEACHER','STAFF','ACCOUNTANT','PARENT','STUDENT','PARTNER','DRIVER'])('keeps %s unable to change the schedule', async role => {
    fixture.context.roles = [membership(role)];
    expect((await request('PUT',7,{revision:0,schedule:defaultAttendanceSchedule,reason:'Attempt change'})).status).toBe(404);
    expect(fixture.writes).toBe(0);
  });
  it('denies a different tenant, inactive Admin and dual-role Owner before writes', async () => {
    for (const roles of [[membership('SCHOOL_ADMIN',8)],[membership('SCHOOL_ADMIN',7,'INACTIVE')],[membership(),membership('PLATFORM_OWNER',null)]]) {
      fixture.context.roles = roles;
      expect((await request('PUT',7,{revision:0,schedule:defaultAttendanceSchedule,reason:'Attempt change'})).status).toBe(404);
    }
    expect(fixture.writes).toBe(0);
  });
});
