import type { captureOriginalRows } from "./fixture-retention-guard";

export interface DatabaseIdentity {
  db: string;
  started: string;
  school_ids_hash: string;
  schools: number | string;
}
export interface Baseline {
  identity: DatabaseIdentity;
  records: Record<string, { count: number | string; digest: string }>;
}
export interface MigrationProof {
  identity: DatabaseIdentity;
  migrations: string[];
  preservedTables: number;
  portals: { portals: number; open: number };
  ledgerBefore: { count: number; digest: string };
}
export interface Evidence {
  baseline: Baseline; proof: MigrationProof; baselineText: string; proofText: string;
  baselineHash: string; proofHash: string;
}
export interface FixtureIdentity {
  role: string; firstName: string; lastName: string; email: string;
  clerkUserId: string | null; appUserId: number | null; clerkDeleted?: boolean;
}
export interface FixtureManifest {
  label: string; nonce: string; createdAt: string; state: string;
  developmentIdentity: DatabaseIdentity; baselineSha256: string; migrationProofSha256: string;
  clerkManagementStatus: string; fixtureIdentities: FixtureIdentity[];
  ids: {
    schoolId: number | null; classAId: number | null; classBId: number | null;
    sourceSessionId: number | null; targetSessionId: number | null;
    sourceTermId: number | null; targetTermId: number | null;
    student1Id: number | null; student2Id: number | null;
    parent1Id: number | null; parent2Id: number | null; employeeId: number | null;
    partnerProfileId: number | null; parent1StudentLinkId: number | null; parent2StudentLinkId: number | null;
    student3Id?: number | null; deviceId?: number | null; nfcCardId?: number | null;
  };
  cleanupPlanDigest: string | null;
  cleanupPlanCounts: { scopedTables: number; retentionLocks: number; temporaryTriggerChanges: number } | null;
  preservationSnapshot?: Awaited<ReturnType<typeof captureOriginalRows>>;
  preservationDigest?: string;
  preservationResult?: unknown;
  retainedHistory?: unknown;
  cleanupMode?: string; provisionedAt?: string; databaseCleanedAt?: string;
  cleanedAt?: string; safeFailure?: unknown;
  nfcSimulation?: { credentialIdentifier: string; secret: string; uid: string; revokedUid: string };
}
export type SchoolFixtureShape = Pick<FixtureManifest, "label" | "nonce" | "fixtureIdentities" | "nfcSimulation"> &
  { ids: Partial<FixtureManifest["ids"]> };
type ClerkUser = {
  id: string; emailAddresses?: { emailAddress: string; verification?: { status: string } | null }[];
  privateMetadata?: Record<string, unknown>;
};
export interface FixtureClerkClient {
  users: {
    createUser(input: {
      emailAddress: string[]; emailAddressIdentificationStatus: string[];
      firstName: string; lastName: string; skipPasswordRequirement: boolean;
      privateMetadata: Record<string, string>;
    }): Promise<ClerkUser>;
    getUser(id: string): Promise<ClerkUser>;
    deleteUser(id: string): Promise<unknown>;
  };
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown) => (typeof value === "number" || typeof value === "string") &&
  value !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
function identity(value: unknown): value is DatabaseIdentity {
  return isRecord(value) && ["db", "started", "school_ids_hash"].every(k => typeof value[k] === "string") &&
    count(value.schools);
}
export function parseBaseline(value: unknown): Baseline {
  if (!isRecord(value) || !identity(value.identity) || !isRecord(value.records) ||
      !Object.values(value.records).every(row => isRecord(row) && count(row.count) && typeof row.digest === "string"))
    throw new Error("Invalid preservation baseline; stopped.");
  return value as unknown as Baseline;
}
export function parseMigrationProof(value: unknown): MigrationProof {
  const portals = isRecord(value) ? value.portals : undefined;
  if (!isRecord(value) || !identity(value.identity) ||
      !Array.isArray(value.migrations) || !value.migrations.every(v => typeof v === "string") ||
      typeof value.preservedTables !== "number" || !count(value.preservedTables) ||
      !isRecord(portals) || !["portals", "open"].every(k => typeof portals[k] === "number" && count(portals[k])) ||
      !isRecord(value.ledgerBefore) || typeof value.ledgerBefore.count !== "number" ||
      !count(value.ledgerBefore.count) || typeof value.ledgerBefore.digest !== "string")
    throw new Error("Invalid migration proof; stopped.");
  return value as unknown as MigrationProof;
}
export function requireSnapshot(manifest: FixtureManifest) {
  if (!manifest.preservationSnapshot) throw new Error("Preservation snapshot missing; stopped.");
  return manifest.preservationSnapshot;
}
export function requireSchoolId(manifest: FixtureManifest): number {
  const id = manifest.ids.schoolId;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
    throw new Error("Owned school ID missing; stopped.");
  return id;
}
export function requireOwnedIdentity(identity: FixtureIdentity) {
  if (typeof identity.appUserId !== "number" || !Number.isSafeInteger(identity.appUserId) ||
      identity.appUserId <= 0 || !identity.clerkUserId)
    throw new Error("Owned fixture identity incomplete; stopped.");
  return { appUserId: identity.appUserId, clerkUserId: identity.clerkUserId, email: identity.email };
}
export function parseFixtureManifest(value: unknown): FixtureManifest {
  if (!isRecord(value) || !identity(value.developmentIdentity) ||
      !["label", "nonce", "createdAt", "state", "baselineSha256", "migrationProofSha256", "clerkManagementStatus"]
        .every(k => typeof value[k] === "string") ||
      !isRecord(value.ids) || !Array.isArray(value.fixtureIdentities))
    throw new Error("Invalid fixture manifest; stopped.");
  for (const row of value.fixtureIdentities) {
    if (!isRecord(row) || !["role", "firstName", "lastName", "email"].every(k => typeof row[k] === "string") ||
        !(row.clerkUserId === null || typeof row.clerkUserId === "string") ||
        !(row.appUserId === null || (typeof row.appUserId === "number" && Number.isSafeInteger(row.appUserId) && row.appUserId > 0)) ||
        !(row.clerkDeleted === undefined || typeof row.clerkDeleted === "boolean"))
      throw new Error("Invalid fixture identity; stopped.");
  }
  const requiredIds = ["schoolId", "classAId", "classBId", "sourceSessionId", "targetSessionId",
    "sourceTermId", "targetTermId", "student1Id", "student2Id", "parent1Id", "parent2Id",
    "employeeId", "partnerProfileId", "parent1StudentLinkId", "parent2StudentLinkId"];
  const ids = value.ids;
  if (requiredIds.some(k => !Object.hasOwn(ids, k)) ||
      !Object.values(ids).every(v => v === null || (typeof v === "number" && Number.isSafeInteger(v) && v > 0)) ||
      !(value.cleanupPlanDigest === null || typeof value.cleanupPlanDigest === "string"))
    throw new Error("Invalid fixture ownership IDs; stopped.");
  if (value.cleanupPlanCounts !== null && (!isRecord(value.cleanupPlanCounts) ||
      !["scopedTables", "retentionLocks", "temporaryTriggerChanges"].every(k =>
        typeof (value.cleanupPlanCounts as Record<string, unknown>)[k] === "number" &&
        count((value.cleanupPlanCounts as Record<string, unknown>)[k]))))
    throw new Error("Invalid cleanup counts; stopped.");
  for (const key of ["preservationDigest", "cleanupMode", "provisionedAt", "databaseCleanedAt", "cleanedAt"])
    if (value[key] !== undefined && typeof value[key] !== "string") throw new Error("Invalid fixture metadata; stopped.");
  if (value.nfcSimulation !== undefined && (!isRecord(value.nfcSimulation) ||
      !["credentialIdentifier", "secret", "uid", "revokedUid"].every(k => typeof (value.nfcSimulation as Record<string, unknown>)[k] === "string")))
    throw new Error("Invalid fixture simulation metadata; stopped.");
  if (value.preservationSnapshot !== undefined) {
    if (!isRecord(value.preservationSnapshot)) throw new Error("Invalid preservation snapshot; stopped.");
    for (const row of Object.values(value.preservationSnapshot))
      if (!isRecord(row) || !Array.isArray(row.columns) || !row.columns.every(c => typeof c === "string") ||
          !isRecord(row.hashes) || !Object.values(row.hashes).every(v => typeof v === "number" && count(v)) ||
          typeof row.count !== "number" || !count(row.count))
        throw new Error("Invalid preservation snapshot row; stopped.");
  }
  // Opaque diagnostic fields are never used as authorization/ownership inputs.
  return value as unknown as FixtureManifest;
}
