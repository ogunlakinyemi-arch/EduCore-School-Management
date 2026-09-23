import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

describe("platform device phase 5 security contract", () => {
  it("locks every credential and lifecycle mutation in a transaction", () => {
    expect(source).toMatch(/credentials[\s\S]+?BEGIN[\s\S]+?FOR UPDATE/);
    expect(source).toMatch(/suspend[\s\S]+?BEGIN[\s\S]+?FOR UPDATE/);
    expect(source).toMatch(/router\.patch\("\/platform\/devices\/:deviceId"[\s\S]+?BEGIN[\s\S]+?FOR UPDATE/);
    expect(source).toMatch(/router\.post\("\/platform\/devices\/:deviceId\/assign"[\s\S]+?BEGIN[\s\S]+?FOR UPDATE/);
  });

  it("supports suspended devices and clears class/configuration on unassignment", () => {
    expect(source).toContain('"SUSPENDED"');
    expect(source).toMatch(/school_class_id=CASE WHEN \$3::boolean/);
    expect(source).toMatch(/configuration_status=CASE WHEN \$3::boolean/);
    expect(source).toContain('unassigned ? "UNASSIGNED" : "REASSIGNED"');
  });

  it("returns assignment fields and never logs the one-time secret", () => {
    expect(source).toContain('d.location');
    expect(source).toContain('d.school_class_id AS "classId"');
    expect(source).toContain('d.configuration_status AS "configurationStatus"');
    expect(source).not.toMatch(/console\.(log|error)[\s\S]{0,200}secret/);
  });
});