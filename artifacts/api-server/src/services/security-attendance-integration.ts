import { createHash } from "node:crypto";
import type { Request } from "express";
import { AuthError } from "../middlewares/auth";
import {
  persistRejectedSecurityTap,
  recordSecurityEventFromAttendance,
  type RejectedTapInput,
} from "./school-security-core-service";
import { logger } from "../lib/logger";

type DeviceIdentity = { schoolId: number; deviceId: number; credentialId: number };
type QueryClient = Parameters<typeof recordSecurityEventFromAttendance>[0];

export class SecurityIdentityRejection extends AuthError {
  constructor(readonly reasonCode: RejectedTapInput["reasonCode"]) {
    super(403, "NFC security identity validation rejected this tap");
  }
}

/** A security notification replaces, rather than duplicates, the legacy gate notification. */
export async function joinSecurityAttendance(client: QueryClient, attendanceEventId: number) {
  const event = await recordSecurityEventFromAttendance(client, attendanceEventId);
  if (event?.identityResult === "REJECTED") {
    throw new SecurityIdentityRejection(event.reasonCode ?? "OTHER");
  }
  return event !== null;
}

/**
 * Call only after the authoritative transaction has rolled back/released.
 * No caller-supplied person or card FK is carried into an unauthorised tap.
 */
export async function recordAuthenticatedNfcDenial(req: Request, device: DeviceIdentity, error: unknown) {
  const body = req.body ?? {};
  const eventType = String(body.eventType ?? "").toUpperCase();
  if (!["SCHOOL_ENTRY", "SCHOOL_EXIT"].includes(eventType)) return;
  if (String(body.identificationMethod ?? "NFC").toUpperCase() !== "NFC") return;
  if (!(error instanceof AuthError) || ![403, 404].includes(error.statusCode)) return;
  const occurredAt = new Date(body.occurredAt);
  // Do not invent a device timestamp when the request has no usable time.
  if (!body.occurredAt || !Number.isFinite(occurredAt.getTime()) ||
      occurredAt.getTime() > Date.now() + 300_000 ||
      occurredAt.getTime() < Date.now() - 86_400_000) return;
  const uid = String(body.nfcUid ?? "").trim();
  if (!uid || uid.length > 160) return;
  const reasonCode = error instanceof SecurityIdentityRejection ? error.reasonCode
    : /card/i.test(error.message) ? "UNKNOWN_CARD"
    : /payment|billing|subscription/i.test(error.message) ? "STAFF_BILLING_INELIGIBLE"
    : "INACTIVE_PERSON";
  try {
    await persistRejectedSecurityTap({
      ...device,
      occurredAt,
      uid,
      eventType: eventType === "SCHOOL_ENTRY" ? "ENTRY" : "EXIT",
      reasonCode,
      eventKey: createHash("sha256").update(
        `${device.schoolId}:${device.deviceId}:${eventType}:${occurredAt.toISOString()}:${uid.toUpperCase()}`,
      ).digest("hex"),
    });
  } catch {
    // A logging failure must not turn an identity denial into an acceptance.
    // No request body, raw UID, credential, or provider error is logged.
    logger.error({ schoolId: device.schoolId, deviceId: device.deviceId },
      "Could not persist rejected authenticated NFC security tap");
  }
}