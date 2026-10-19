import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEmployeeBody, UpdateEmployeeBody, CreateParentBody, UpdateParentBody } from "@workspace/api-zod";

const query = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => ({ pool: { query } }));
import { personTitleWrite } from "./person-title";

beforeEach(() => { query.mockReset(); });

describe("person-title compatibility gate", () => {
  it.each(["parents", "employees"] as const)("does not query or alter omitted titles in %s", async table => {
    expect(await personTitleWrite(table, undefined, 9)).toMatchObject({ params: [], column: "", assignment: "" });
    expect(query).not.toHaveBeenCalled();
  });
  it.each(["parents", "employees"] as const)("rejects selected titles before writes when %s is not upgraded", async table => {
    query.mockResolvedValue({ rows: [{ ready: false }] });
    await expect(personTitleWrite(table, "Dr", 9)).rejects.toMatchObject({ statusCode: 409 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![1]).toEqual([table]);
    expect(await personTitleWrite(table, null, 9)).toMatchObject({ params: [] });
  });
  it("preserves explicit clears as SQL NULL rather than COALESCE", async () => {
    query.mockResolvedValue({ rows: [{ ready: true }] });
    expect(await personTitleWrite("parents", null, 11)).toEqual({
      column: ", person_title", value: ", $11", assignment: ", person_title=$11", params: [null],
    });
    expect((await personTitleWrite("employees", "Prof", 16)).params).toEqual(["Prof"]);
  });
  it("validates all four create/update contracts and never rewrites a name", () => {
    const inputs = [
      [CreateParentBody, { name: "Example Parent", email: "example@school.test", phone: "08000000000" }],
      [UpdateParentBody, {}],
      [CreateEmployeeBody, { firstName: "Example", lastName: "Teacher", type: "TEACHER" }],
      [UpdateEmployeeBody, {}],
    ] as const;
    for (const [schema, base] of inputs) {
      expect(schema.parse({ ...base, personTitle: "Dr" }).personTitle).toBe("Dr");
      expect(schema.parse({ ...base, personTitle: null }).personTitle).toBeNull();
      expect(schema.parse(base).personTitle).toBeUndefined();
      expect(schema.safeParse({ ...base, personTitle: "invented" }).success).toBe(false);
      expect(schema.safeParse({ ...base, personTitle: "" }).success).toBe(false);
    }
    expect(CreateParentBody.parse({ ...inputs[0][1], personTitle: "Dr" }).name).toBe("Example Parent");
  });
});
