export type InvitationCommitResolution = "COMMITTED" | "ABORTED" | "UNKNOWN";

type InvitationCommitRecovery = {
  commit: () => Promise<unknown>;
  rollback: () => Promise<unknown>;
  isCommitted: () => Promise<boolean>;
  revokeInvitation?: () => Promise<unknown>;
};

/**
 * Resolve a lost/failed COMMIT response before deciding whether its external Clerk invite
 * can be revoked. An inconclusive database check deliberately keeps the invite active.
 */
export async function commitInvitationWithRecovery({
  commit,
  rollback,
  isCommitted,
  revokeInvitation,
}: InvitationCommitRecovery): Promise<InvitationCommitResolution> {
  try {
    await commit();
    return "COMMITTED";
  } catch {
    let rollbackSucceeded = true;
    try {
      await rollback();
    } catch {
      rollbackSucceeded = false;
    }

    let committed: boolean;
    try {
      committed = await isCommitted();
    } catch {
      return "UNKNOWN";
    }
    if (committed) return "COMMITTED";
    if (!rollbackSucceeded) return "UNKNOWN";

    if (revokeInvitation) {
      try {
        await revokeInvitation();
        return "ABORTED";
      } catch {
        return "UNKNOWN";
      }
    }
    return "ABORTED";
  }
}