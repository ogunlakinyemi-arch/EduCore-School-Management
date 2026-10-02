import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  objectName: "",
  getMetadata: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket(name: string) {
      return {
        name,
        file: (objectName: string) => {
          state.objectName = objectName;
          return {
            name: objectName,
            bucket: { name },
            getMetadata: state.getMetadata,
            download: state.download,
          };
        },
      };
    }
  },
}));

import {
  assertSchoolSecurityIncidentObject,
  isSchoolSecurityIncidentAttachmentPath,
  newSchoolSecurityIncidentAttachmentPath,
} from "./school-security-incident-storage";

const originalPrivateObjectDir = process.env.PRIVATE_OBJECT_DIR;

afterEach(() => {
  if (originalPrivateObjectDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
  else process.env.PRIVATE_OBJECT_DIR = originalPrivateObjectDir;
  vi.clearAllMocks();
});

describe("private school security incident objects", () => {
  it("uses a tenant- and incident-owned private prefix", () => {
    const path = newSchoolSecurityIncidentAttachmentPath(12, 34);
    expect(isSchoolSecurityIncidentAttachmentPath(path, 12, 34)).toBe(true);
    expect(isSchoolSecurityIncidentAttachmentPath(path, 12, 35)).toBe(false);
    expect(isSchoolSecurityIncidentAttachmentPath(path, 13, 34)).toBe(false);
    expect(isSchoolSecurityIncidentAttachmentPath("/objects/admissions/12/34/12345678-1234-1234-1234-123456789abc", 12, 34)).toBe(false);
  });

  it("checks the private object owner's prefix, declared metadata, size and file signature", async () => {
    process.env.PRIVATE_OBJECT_DIR = "/security-test-bucket/private";
    const path = newSchoolSecurityIncidentAttachmentPath(12, 34);
    const pdf = Buffer.from("%PDF-1.7\n");
    state.getMetadata.mockResolvedValueOnce([{
      size: String(pdf.length),
      contentType: "application/pdf; charset=binary",
    }]);
    state.download.mockResolvedValueOnce([pdf]);

    await expect(assertSchoolSecurityIncidentObject(path, 12, 34, "application/pdf", pdf.length)).resolves.toBeUndefined();
    expect(state.objectName).toMatch(/^private\/school-security\/12\/34\/[0-9a-f-]{36}$/i);
  });

  it("rejects mismatched metadata, signatures, and out-of-tenant object paths", async () => {
    process.env.PRIVATE_OBJECT_DIR = "/security-test-bucket/private";
    const path = newSchoolSecurityIncidentAttachmentPath(12, 34);
    state.getMetadata.mockResolvedValueOnce([{ size: "5", contentType: "image/png" }]);
    await expect(assertSchoolSecurityIncidentObject(path, 12, 34, "application/pdf", 5)).rejects.toThrow(/metadata does not match/);

    state.getMetadata.mockResolvedValueOnce([{ size: "5", contentType: "application/pdf" }]);
    state.download.mockResolvedValueOnce([Buffer.from("notpdf")]);
    await expect(assertSchoolSecurityIncidentObject(path, 12, 34, "application/pdf", 5)).rejects.toThrow(/content does not match/);

    await expect(assertSchoolSecurityIncidentObject(path, 9, 34, "application/pdf", 5)).rejects.toThrow(/ownership path/);
  });
});