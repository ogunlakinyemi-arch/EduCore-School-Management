import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UpdateParentBody } from "@workspace/api-zod";

const people = readFileSync(new URL("./people.ts", import.meta.url), "utf8");
const core = readFileSync(new URL("./edupulse.ts", import.meta.url), "utf8");

describe("parent preference persistence regression guards", () => {
  it("does not strip selected relationships at the update validation boundary", () => {
    for (const relationshipType of ["Mother", "Father", "Guardian"]) {
      expect(UpdateParentBody.parse({ relationshipType })).toEqual({ relationshipType });
    }
    expect(UpdateParentBody.safeParse({ relationshipType: "Invalid" }).success).toBe(false);
  });
  it("returns persisted preferences in both list and detail reads", () => {
    for (const source of [people, core]) {
      expect(source).toContain('p.default_relationship_type AS "relationshipType"');
      expect(source).toContain('p.emergency_contact_phone AS "emergencyContactPhone"');
    }
  });

  it("stores creation values instead of only echoing the request", () => {
    const create = core.match(/router\.post\("\/parents",[\s\S]*?\n\}\);/)![0];
    expect(create).toContain("default_relationship_type, emergency_contact_name, emergency_contact_phone");
    expect(create).toContain('default_relationship_type AS "relationshipType"');
    expect(create).not.toContain("relationshipType: body.relationshipType");
  });

  it("updates the preference without overwriting existing child relationships", () => {
    const update = people.match(/`(UPDATE parents SET name[\s\S]*?)`/)![1];
    expect(update).toContain("default_relationship_type = COALESCE($8, default_relationship_type)");
    expect(update).toContain("WHERE id = $6 AND school_id = $7");
    expect(update).not.toContain("parent_student_relationships");
    expect(core).toContain('parent.rows[0].defaultRelationshipType ?? "Guardian"');
  });
});