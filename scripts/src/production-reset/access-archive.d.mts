export interface ArchiveDb { query(sql: string, values?: any[]): Promise<any> }
export class ArchiveAccessError extends Error { code: string }
export const ACCESS_ARCHIVE_EVENT: string;
export function activeAccessArchives(db: ArchiveDb): Promise<any[]>;
export function assertArchiveAccess(db: ArchiveDb, input: {
  userId?: number | null; email?: string | null; schoolId?: number; partnerId?: number; reapplicationUserId?: number;
}): Promise<void>;
export function prepareAccessArchive(db: ArchiveDb, input: { schoolIds: number[]; partnerIds: number[] }): Promise<any>;
export function applyAccessArchive(db: ArchiveDb, input: {
  plan?: any; actorUserId: number; batchId: string; restore?: boolean;
}): Promise<any>;
