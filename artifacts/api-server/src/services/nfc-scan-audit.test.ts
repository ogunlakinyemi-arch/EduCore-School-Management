import { describe, it, expect, vi } from "vitest";
import { canonicalScanUid, recordNfcDiagnostic, scanAuditFilters, scanReason, listScanAudit } from "./nfc-scan-audit";
import { AuthError } from "../middlewares/auth";

describe("restricted NFC scan audit boundaries", () => {
  it.each([8,14,20])("canonicalizes a genuine %i-character UID", n => {
    expect(canonicalScanUid("a".repeat(n))).toBe("A".repeat(n));
  });
  it.each(["unknown","AA:BB:CC:DD","aabbccdd ",null,12])("does not invent a UID from %s", value => {
    expect(canonicalScanUid(value)).toBeNull();
  });
  it("bounds authenticated diagnostics and strips malformed UID and arbitrary fields", async () => {
    const query=vi.fn().mockResolvedValue({rows:[]});
    await recordNfcDiagnostic({query},{deviceId:3,schoolId:7,source:"SCHOOL",kind:"MALFORMED",
      reason:"MALFORMED_REPORT",eventId:"x".repeat(300),occurredAt:"not a timestamp",uid:"aabbccdd"});
    const metadata=JSON.parse(query.mock.calls[0][1][3]);
    expect(metadata).toMatchObject({uid:null,eventId:null,occurredAt:null,schoolId:7});
    expect(Object.keys(metadata)).not.toContain("Authorization");
  });
  it("labels exact retries separately without making inventory provenance", async () => {
    const query=vi.fn().mockResolvedValue({rows:[]});
    await recordNfcDiagnostic({query},{deviceId:3,schoolId:null,source:"OWNER",kind:"RETRY",
      reason:"EXACT_RETRY",eventId:"scan-1",uid:"aabbccdd"});
    expect(query.mock.calls[0][1][2]).toBe("RETRY");
    expect(JSON.parse(query.mock.calls[0][1][3])).toMatchObject({uid:"AABBCCDD",kind:"RETRY"});
  });
  it.each([{page:0},{pageSize:101},{schoolId:-1},{source:"STAFF"},{registration:"ACTIVE"},
    {kind:"TAP"},{from:"yesterday"},{extra:"uid"}])("rejects invalid filters %j", q => {
    expect(scanAuditFilters.safeParse({view:"scans",...q}).success).toBe(false);
  });
  it("validates chronological dates by instant, not timezone spelling", () => {
    expect(scanAuditFilters.safeParse({view:"scans",from:"2026-11-02T10:00:00+02:00",
      to:"2026-11-02T09:00:00Z"}).success).toBe(true);
  });
  it("keeps stable reason codes, not personal error text", () => {
    expect(scanReason(new AuthError(403,"NFC card is invalid for this student or school"))).toBe("CARD_INELIGIBLE");
    expect(scanReason(new AuthError(409,"event_id was already used for different data"))).toBe("EVENT_CONFLICT");
  });
  it("restricts CSV exports instead of silently truncating", async () => {
    const query=vi.fn().mockResolvedValue({rows:[{total:5001,rows:[]}]});
    await expect(listScanAudit({query},scanAuditFilters.parse({view:"scans",format:"CSV"})))
      .rejects.toMatchObject({statusCode:409});
  });
});
