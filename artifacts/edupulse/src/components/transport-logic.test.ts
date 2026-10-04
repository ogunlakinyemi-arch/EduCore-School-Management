import { describe, expect, it } from 'vitest';
import { activeDrivers, capacityState, errorMessage, familyAudience, ownerTotals, selectableStudents, stopsFor, transportAudience, validateEffective } from './transport-logic';

const roles = (...r: Array<[string, number | null]>) => r.map(([role, schoolId]) => ({ role, schoolId, status: 'ACTIVE' }));

describe('transport roles', () => {
  it('keeps Platform Owner read-only even with a School Admin role', () => {
    expect(transportAudience({ isPlatformOwner: true, roles: roles(['SCHOOL_ADMIN', 4]) }, 4)).toBe('owner');
  });
  it('lets only the active-school School Admin manage', () => {
    expect(transportAudience({ roles: roles(['SCHOOL_ADMIN', 4]) }, 4)).toBe('admin');
    expect(transportAudience({ roles: roles(['SCHOOL_ADMIN', 4]) }, 9)).toBe('denied');
    expect(transportAudience({ roles: roles(['TEACHER', 4]) }, 4)).toBe('denied');
  });
  it('resolves family audiences', () => {
    expect(familyAudience({ roles: roles(['PARENT', 1]) })).toBe('parent');
    expect(familyAudience({ roles: roles(['STUDENT', 1]) })).toBe('student');
    expect(familyAudience({ roles: roles(['PARENT', 1], ['STUDENT', 1]) })).toBe('both');
    expect(familyAudience({ isPlatformOwner: true, roles: roles(['PARENT', 1]) })).toBe('denied');
  });
});

describe('drivers, stops and students', () => {
  it('only offers drivers', () => {
    expect(activeDrivers([{ employeeType: 'DRIVER' }, { employeeType: 'TEACHER' }])).toHaveLength(1);
  });
  it('filters stops by kind and activity in sequence order', () => {
    const route = { stops: [
      { id: 1, stopType: 'DROPOFF', sequence: 1, isActive: true },
      { id: 2, stopType: 'BOTH', sequence: 3, isActive: true },
      { id: 3, stopType: 'PICKUP', sequence: 2, isActive: true },
      { id: 4, stopType: 'PICKUP', sequence: 0, isActive: false },
    ] } as never;
    expect(stopsFor(route, 'PICKUP').map(s => s.id)).toEqual([3, 2]);
  });
  it('hides students who already ride actively', () => {
    const list = [
      { studentId: 1 },
      { studentId: 2, activeAssignment: { status: 'ACTIVE', id: 1 } },
      { studentId: 3, activeAssignment: { status: 'SUSPENDED', id: 2 } },
    ] as never;
    expect(selectableStudents(list).map(s => s.studentId)).toEqual([1]);
  });
});

describe('capacity, errors and validation', () => {
  it('detects full buses', () => {
    expect(capacityState({ capacity: 30, passengerCount: 30 }).full).toBe(true);
    expect(capacityState({ capacity: 30, passengerCount: 12 })).toMatchObject({ left: 18, full: false, pct: 40 });
  });
  it('surfaces clear capacity and duplicate errors', () => {
    expect(errorMessage({ data: { code: 'BUS_CAPACITY_EXCEEDED' } })).toMatch(/full capacity/);
    expect(errorMessage({ data: { code: 'DUPLICATE_ASSIGNMENT', error: 'Student already assigned.' } })).toBe('Student already assigned.');
    expect(errorMessage(null)).toMatch(/try again/);
  });
  it('requires date and reason', () => {
    expect(validateEffective('', 'x')).toMatch(/date/);
    expect(validateEffective('2025-01-01', ' ')).toMatch(/reason/);
    expect(validateEffective('2025-01-01', 'Moved house')).toBeNull();
  });
  it('totals owner overview rows', () => {
    const t = ownerTotals([
      { busCount: 2, routeCount: 3, busCapacity: 60, reservedPassengerCount: 40, activeStudents: 38, inactiveStudents: 2, activeStaff: 3, activeDrivers: 2, transportRevenueMinor: 100, outstandingMinor: 10 },
      { busCount: 1, routeCount: 1, busCapacity: 20, reservedPassengerCount: 5, activeStudents: 5, inactiveStudents: 0, activeStaff: 1, activeDrivers: 1, transportRevenueMinor: 50, outstandingMinor: 0 },
    ]);
    expect(t).toMatchObject({ buses: 3, capacity: 80, passengers: 45, revenue: 150, drivers: 3 });
  });
});

import { routeBlock, busesFromRoutes, routesForBus, driverAudience, driverSchools } from './transport-logic';
describe('driver and bus-first routing', () => {
  const r = (o: object) => ({ id: 1, busId: 2, status: 'ACTIVE', busCapacity: 10, reservedPassengerCount: 3, ...o }) as never;
  it('blocks full, inactive-bus and unemployed-driver routes', () => {
    expect(routeBlock(r({}))).toBeNull();
    expect(routeBlock(r({ reservedPassengerCount: 10 }))).toMatch(/full/);
    expect(routeBlock(r({ busStatus: 'MAINTENANCE' }))).toMatch(/bus/);
    expect(routeBlock(r({ driverEmploymentStatus: 'TERMINATED' }))).toMatch(/driver/);
  });
  it('credits only the existing rider on their current reserved bus', () => {
    const full = r({ busId: 2, reservedPassengerCount: 10 });
    expect(routeBlock(full, 2)).toBeNull();
    expect(routeBlock(full, 9)).toMatch(/full/);
    expect(routeBlock(r({ busId: 2, reservedPassengerCount: 11 }), 2)).toMatch(/full/);
  });
  it('groups routes by bus', () => {
    const rs = [r({ id: 1, busId: 2 }), r({ id: 2, busId: 2 }), r({ id: 3, busId: 5 })];
    expect(busesFromRoutes(rs)).toHaveLength(2);
    expect(routesForBus(rs, '2')).toHaveLength(2);
  });
  it('driver audience excludes owner', () => {
    const roles = [{ role: 'DRIVER', status: 'ACTIVE', schoolId: 4 }];
    expect(driverAudience({ roles })).toBe(true);
    expect(driverAudience({ isPlatformOwner: true, roles })).toBe(false);
    expect(driverSchools({ roles })).toEqual([4]);
  });
});

import { busChoice } from './transport-logic';
describe('bus picker choices', () => {
  const bus = (status: string) => ({ status, capacity: 10, passengerCount: 1 }) as never;
  it('lists a bus with no routes but explains it', () => {
    const c = busChoice(bus('ACTIVE'), [], 7);
    expect(c.disabled).toBe(false); expect(c.activeRoutes).toBe(0); expect(c.note).toMatch(/no active route/);
  });
  it('disables maintenance buses and counts routes', () => {
    expect(busChoice(bus('MAINTENANCE'), [], 7).disabled).toBe(true);
    expect(busChoice(bus('ACTIVE'), [{ busId: 7, status: 'ACTIVE' }, { busId: 7, status: 'INACTIVE' }], 7).activeRoutes).toBe(1);
  });
  it('disables a full target bus but permits an already-reserved rider to keep their seat', () => {
    const full = { status: 'ACTIVE', capacity: 1, passengerCount: 1, reservedPassengerCount: 1 };
    expect(busChoice(full, [], 7).disabled).toBe(true);
    expect(busChoice(full, [], 7, 7).disabled).toBe(false);
    expect(busChoice(full, [], 7, 8).disabled).toBe(true);
  });
});
