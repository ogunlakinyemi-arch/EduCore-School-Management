import { describe, expect, it } from "vitest";
import {
  incidentAttachmentUploadInputSchema,
  incidentInputSchema,
  incidentOutputSchema,
  incidentPatchSchema,
  pickupCompletionInputSchema,
  pickupRequestOutputSchema,
  pickupDecisionInputSchema,
  pickupPersonInputSchema,
  visitorPatchSchema,
} from "./school-security-operations";

describe("school security operation contracts", () => {
  it("normalizes PostgreSQL bigint EXIT identifiers without accepting unsafe integers", () => {
    const field = pickupRequestOutputSchema.shape.recordedSecurityEventId;
    expect(field.parse("88")).toBe(88);
    expect(field.parse(null)).toBeNull();
    expect(field.safeParse("9007199254740993").success).toBe(false);
  });
  it("requires a bounded validity interval for pickup nominations", () => {
    const valid = pickupPersonInputSchema.safeParse({
      fullName: "Auntie A",
      phone: "+2348000000000",
      validFrom: "2026-04-01T08:00:00Z",
      validUntil: "2026-04-01T17:00:00Z",
    });
    expect(valid.success).toBe(true);
    expect(pickupPersonInputSchema.safeParse({
      fullName: "Auntie A",
      phone: "+2348000000000",
      validFrom: "2026-04-01T17:00:00Z",
      validUntil: "2026-04-01T08:00:00Z",
    }).success).toBe(false);
  });

  it("requires optimistic versions and the typed person/recorded-exit references for pickup completion", () => {
    expect(pickupDecisionInputSchema.safeParse({
      expectedVersion: 1,
      decision: "APPROVE",
      reason: "Verified by school security",
    }).success).toBe(true);
    expect(pickupDecisionInputSchema.safeParse({
      decision: "APPROVE",
      reason: "Verified by school security",
    }).success).toBe(false);
    const completion = {
      expectedVersion: 2,
      pickupPersonId: 10,
      recordedSecurityEventId: 88,
    };
    expect(pickupCompletionInputSchema.safeParse(completion).success).toBe(true);
    expect(pickupCompletionInputSchema.safeParse({
      expectedVersion: 1,
      pickupPersonId: 10,
    }).success).toBe(false);
    expect(pickupCompletionInputSchema.safeParse({ ...completion, unexpected: true }).success).toBe(false);
  });

  it("rejects empty visitor edits and accepts only a typed, versioned amendment", () => {
    expect(visitorPatchSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(visitorPatchSchema.safeParse({ expectedVersion: 1, notes: null }).success).toBe(true);
    expect(visitorPatchSchema.safeParse({ expectedVersion: 1, status: "CHECKED_OUT" }).success).toBe(false);
  });

  it("validates incident people references and emits no untyped extra output fields", () => {
    const incident = {
      incidentType: "VISITOR_ISSUE",
      occurredAt: "2026-04-01T08:00:00Z",
      description: "Visitor presented invalid identification",
      involvedPersons: [{ personType: "VISITOR", personId: 4 }],
    };
    expect(incidentInputSchema.safeParse(incident).success).toBe(true);
    expect(incidentInputSchema.safeParse({
      ...incident,
      involvedPersons: Array.from({ length: 21 }, (_, index) => ({
        personType: "VISITOR",
        personId: index + 1,
      })),
    }).success).toBe(false);
    expect(incidentPatchSchema.safeParse({ expectedVersion: 1, involvedPersons: [{ personType: "STUDENT", personId: 8 }] }).success).toBe(true);
    expect(incidentOutputSchema.safeParse({
      id: 1,
      schoolId: 3,
      incidentType: "VISITOR_ISSUE",
      occurredAt: "2026-04-01T08:00:00Z",
      securityLocationId: null,
      securityDeviceId: null,
      studentId: null,
      involvedPersons: [{ personType: "VISITOR", personId: 4 }],
      assignedStaffUserId: null,
      description: "Visitor presented invalid identification",
      severity: "LOW",
      status: "OPEN",
      resolution: null,
      createdByUserId: 7,
      version: 1,
      createdAt: "2026-04-01T08:00:00Z",
      updatedAt: "2026-04-01T08:00:00Z",
      privateUnvalidatedField: "must not leak",
    }).success).toBe(false);
  });

  it("rejects unsafe incident attachment names, types, and oversized objects", () => {
    const valid = {
      fileName: "gate-report.pdf",
      contentType: "application/pdf",
      byteSize: 128,
    };
    expect(incidentAttachmentUploadInputSchema.safeParse(valid).success).toBe(true);
    expect(incidentAttachmentUploadInputSchema.safeParse({ ...valid, fileName: "../gate-report.pdf" }).success).toBe(false);
    expect(incidentAttachmentUploadInputSchema.safeParse({ ...valid, fileName: "gate-\nreport.pdf" }).success).toBe(false);
    expect(incidentAttachmentUploadInputSchema.safeParse({ ...valid, contentType: "image/svg+xml" }).success).toBe(false);
    expect(incidentAttachmentUploadInputSchema.safeParse({
      ...valid,
      byteSize: 10 * 1024 * 1024 + 1,
    }).success).toBe(false);
  });
});