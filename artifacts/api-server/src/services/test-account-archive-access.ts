import { pool } from "@workspace/db";
import { assertArchiveAccess, ArchiveAccessError } from "../../../../scripts/src/production-reset/access-archive.mjs";
import { AuthError } from "../middlewares/auth";

export async function assertTestArchiveAccess(
  input: { userId?: number | null; email?: string | null; schoolId?: number; partnerId?: number },
  db: { query: (...args: any[]) => Promise<any> } = pool,
) {
  try { await assertArchiveAccess(db, input); }
  catch (error) {
    if (error instanceof ArchiveAccessError && error.code === "ARCHIVED_TEST_ACCESS_BLOCKED") {
      throw new AuthError(403, "Access to this archived test account or school has been revoked.", "ARCHIVED_TEST_ACCESS_BLOCKED");
    }
    // Missing/unreadable control evidence must not silently grant access.
    throw new AuthError(503, "Archive access verification is temporarily unavailable.", "ARCHIVE_ACCESS_UNAVAILABLE");
  }
}
