import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";

/** Old databases remain usable. Never silently discard a selected title or
 * insert a person and only then discover that their title cannot be saved. */
export async function personTitleWrite(
  table: "parents" | "employees",
  value: string | null | undefined,
  parameter: number,
) {
  const none = { column: "", value: "", assignment: "", params: [] as unknown[] };
  if (value === undefined) return none;
  const result = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM pg_attribute
      WHERE attrelid=to_regclass($1) AND attname='person_title'
        AND attnum>0 AND NOT attisdropped) AS ready`,
    [table],
  );
  if (result.rows[0]?.ready !== true) {
    // With no column there can be no previously stored title to clear.
    if (value === null) return none;
    throw new AuthError(409, "Saving person titles requires the reviewed person-title database migration. No record was changed.");
  }
  return { column: ", person_title", value: `, $${parameter}`, assignment: `, person_title=$${parameter}`, params: [value] };
}
