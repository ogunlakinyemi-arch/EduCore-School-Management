import { describe, expect, it } from "vitest";
import { Storage } from "@google-cloud/storage";

// Structural smoke test of the real compatible SDK. No I/O, signing, ADC
// discovery or metadata methods are invoked; external fetch is also blocked by
// the unit-test setup. This is not a live App Storage integration test.
describe("Google Storage 8.x public interface used by EduCore", () => {
  it("retains bucket/file factories without accessing a provider", () => {
    const storage = new Storage({ projectId: "synthetic-offline-contract" });
    const bucket = storage.bucket("synthetic-contract-bucket");
    const file = bucket.file("synthetic/contract.txt");
    expect(bucket.name).toBe("synthetic-contract-bucket");
    expect(file.name).toBe("synthetic/contract.txt");
    expect(file.bucket).toBe(bucket);
  });
  it("retains upload, metadata, stream and signing method interfaces", () => {
    const bucket = new Storage({ projectId: "synthetic-offline-contract" }).bucket("synthetic-contract-bucket");
    const file = bucket.file("synthetic/contract.txt");
    for (const method of ["getMetadata", "createReadStream", "createWriteStream", "getSignedUrl", "download", "delete"] as const)
      expect(typeof file[method]).toBe("function");
    expect(typeof bucket.upload).toBe("function");
  });
});
