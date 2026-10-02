import { describe, expect, it } from "vitest";
import { loadPrintablePhoto, loadPrintableSchoolLogo } from "./nfc-printable-images";

describe("NFC printable managed image scope", () => {
  it("rejects arbitrary URLs and all off-school or off-person photo paths without fetching", async () => {
    expect(await loadPrintablePhoto(8, 14, "https://169.254.169.254/latest/meta-data/", "student")).toBeNull();
    expect(await loadPrintablePhoto(8, 14, "/objects/student-photos/9/14/11111111-1111-4111-8111-111111111111", "student")).toBeNull();
    expect(await loadPrintablePhoto(8, 14, "/objects/student-photos/8/15/11111111-1111-4111-8111-111111111111", "student")).toBeNull();
    expect(await loadPrintablePhoto(8, 14, "/objects/employee-photos/8/14/11111111-1111-4111-8111-111111111111", "student")).toBeNull();
  });

  it("rejects untrusted and cross-school logo paths instead of making remote requests", async () => {
    expect(await loadPrintableSchoolLogo(8, "https://example.com/logo.png")).toBeNull();
    expect(await loadPrintableSchoolLogo(8, "/objects/school-logos/9/11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(await loadPrintableSchoolLogo(8, "/api/schools/8/branding/logo")).toBeNull();
  });
});