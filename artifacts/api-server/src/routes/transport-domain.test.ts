import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

import { AuthError } from "../middlewares/auth";
import {
  ensureTransportArrivalAfterDeparture,
  ensureTransportSeatAvailable,
  isValidTransportStopPair,
  normalizeTransportTime,
  normalizeTransportWeekdays,
  projectTransportInvoiceStatus,
  requireAllowedKeys,
  requireReason,
  requireRecordId,
  requireTransportAmountMinor,
  requireTransportDate,
} from "./transport-domain";

function expectInputError(action: () => unknown) {
  expect(action).toThrow(AuthError);
}

describe("transport identifiers and input normalization", () => {
  it("accepts only positive safe record identifiers", () => {
    expect(requireRecordId("12", "id")).toBe(12);
    expect(requireRecordId(2_147_483_647, "id")).toBe(2_147_483_647);
    expectInputError(() => requireRecordId("0", "id"));
    expectInputError(() => requireRecordId("1.5", "id"));
    expectInputError(() => requireRecordId(Number.MAX_SAFE_INTEGER + 1, "id"));
  });

  it("normalizes unique valid weekdays while rejecting duplicates and unknown values", () => {
    expect(normalizeTransportWeekdays(["MONDAY", "THURSDAY"])).toEqual(["MONDAY", "THURSDAY"]);
    expectInputError(() => normalizeTransportWeekdays(["MONDAY", "MONDAY"]));
    expectInputError(() => normalizeTransportWeekdays(["FUNDAY"]));
    expectInputError(() => normalizeTransportWeekdays([]));
  });

  it("accepts valid 24-hour transport times and adds seconds to minutes", () => {
    expect(normalizeTransportTime("07:05", "departureTime")).toBe("07:05:00");
    expect(normalizeTransportTime("23:59:59", "arrivalTime")).toBe("23:59:59");
    expectInputError(() => normalizeTransportTime("24:00", "departureTime"));
    expectInputError(() => normalizeTransportTime("7:05", "departureTime"));
    expect(() => ensureTransportArrivalAfterDeparture("07:00:00", "08:00:00")).not.toThrow();
    expectInputError(() => ensureTransportArrivalAfterDeparture("08:00:00", "07:00:00"));
    expectInputError(() => ensureTransportArrivalAfterDeparture("08:00:00", "08:00:00"));
  });

  it("validates real effective and fee due dates rather than date-like strings", () => {
    expect(requireTransportDate("2027-12-31", "date")).toBe("2027-12-31");
    expectInputError(() => requireTransportDate("2027-02-29", "date"));
    expectInputError(() => requireTransportDate("12/31/2027", "date"));
  });

  it("requires explicit human-readable audit reasons and permitted fields", () => {
    expect(requireReason("Move student near home", "reason")).toBe("Move student near home");
    expectInputError(() => requireReason("ok"));
    expect(requireAllowedKeys({ action: "SUSPEND" }, ["action"])).toEqual({ action: "SUSPEND" });
    expectInputError(() => requireAllowedKeys({ status: "ACTIVE", schoolId: 999 }, ["status"]));
    expectInputError(() => requireAllowedKeys([], []));
  });
});

describe("transport capacity and stop validation", () => {
  it("counts all active/suspended seat reservations before allocating capacity", () => {
    expect(() => ensureTransportSeatAvailable(20, 18, 2)).not.toThrow();
    expectInputError(() => ensureTransportSeatAvailable(20, 19, 2));
    expectInputError(() => ensureTransportSeatAvailable(0, 0));
  });

  it("requires distinct active pickup/drop-off stops of matching types on the chosen route", () => {
    const pickup = { id: 7, stopType: "PICKUP", isActive: true, sequence: 1 };
    const dropoff = { id: 9, stopType: "DROPOFF", isActive: true, sequence: 2 };
    expect(isValidTransportStopPair(pickup, dropoff)).toBe(true);
    expect(isValidTransportStopPair(pickup, pickup)).toBe(false);
    expect(isValidTransportStopPair(pickup, { ...dropoff, isActive: false })).toBe(false);
    expect(isValidTransportStopPair(
      { ...pickup, stopType: "DROPOFF" },
      { ...dropoff, stopType: "PICKUP" },
    )).toBe(false);
    expect(isValidTransportStopPair(
      { ...pickup, stopType: "BOTH" },
      { ...dropoff, stopType: "BOTH" },
    )).toBe(true);
    expect(isValidTransportStopPair(
      { ...pickup, sequence: 3 },
      { ...dropoff, sequence: 2 },
    )).toBe(false);
  });
});

describe("Finance invoice status projection", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("prioritizes deactivation, outstanding balance, due date and configured overdue policy", () => {
    expect(projectTransportInvoiceStatus({
      outstandingMinor: 100,
      feeStatus: "UNPAID",
      dueDate: "2027-05-01",
      assignmentStatus: "DEACTIVATED",
      currentDate: "2027-06-01",
    })).toBe("INACTIVE");
    expect(projectTransportInvoiceStatus({
      outstandingMinor: 0,
      feeStatus: "PAID",
      dueDate: "2027-05-01",
      assignmentStatus: "ACTIVE",
      currentDate: "2027-06-01",
    })).toBe("PAID");
    expect(projectTransportInvoiceStatus({
      outstandingMinor: 250,
      feeStatus: "UNPAID",
      dueDate: "2027-07-01",
      assignmentStatus: "ACTIVE",
      currentDate: "2027-06-01",
    })).toBe("PENDING");
    expect(projectTransportInvoiceStatus({
      outstandingMinor: 250,
      feeStatus: "UNPAID",
      dueDate: "2027-05-01",
      assignmentStatus: "ACTIVE",
      currentDate: "2027-06-01",
    })).toBe("OVERDUE");
    expect(projectTransportInvoiceStatus({
      outstandingMinor: 250,
      feeStatus: "UNPAID",
      dueDate: "2027-05-01",
      assignmentStatus: "ACTIVE",
      currentDate: "2027-06-01",
      suspendWhenOverdue: true,
    })).toBe("SUSPENDED");
    expect(projectTransportInvoiceStatus({
      outstandingMinor: 250,
      feeStatus: "UNPAID",
      dueDate: "2027-05-01",
      assignmentStatus: "SUSPENDED",
      currentDate: "2027-06-01",
    })).toBe("SUSPENDED");
  });

  it("requires safe nonnegative NGN subunit amounts", () => {
    expect(requireTransportAmountMinor(250_000, "fareMinor")).toBe(250_000);
    expect(requireTransportAmountMinor(0, "fareMinor")).toBe(0);
    expectInputError(() => requireTransportAmountMinor(-1, "fareMinor"));
    expectInputError(() => requireTransportAmountMinor(1.25, "fareMinor"));
    expectInputError(() => requireTransportAmountMinor(1_000_000_001, "fareMinor"));
    expectInputError(() => requireTransportAmountMinor(0, "fareMinor", false));
  });
});