import { describe, expect, it, vi } from "vitest";
import { commitInvitationWithRecovery } from "./partner-commit-recovery";

describe("external invitation commit recovery", () => {
  it("keeps the invitation if the commit persisted but its response was lost", async () => {
    const revokeInvitation = vi.fn();
    const resolution = await commitInvitationWithRecovery({
      commit: async () => { throw new Error("lost response"); },
      rollback: async () => undefined,
      isCommitted: async () => true,
      revokeInvitation,
    });
    expect(resolution).toBe("COMMITTED");
    expect(revokeInvitation).not.toHaveBeenCalled();
  });

  it("revokes only when rollback and an independent database read confirm the abort", async () => {
    const revokeInvitation = vi.fn().mockResolvedValue(undefined);
    const resolution = await commitInvitationWithRecovery({
      commit: async () => { throw new Error("commit rejected"); },
      rollback: async () => undefined,
      isCommitted: async () => false,
      revokeInvitation,
    });
    expect(resolution).toBe("ABORTED");
    expect(revokeInvitation).toHaveBeenCalledOnce();
  });

  it("does not revoke when the database result is uncertain", async () => {
    const revokeInvitation = vi.fn();
    const resolution = await commitInvitationWithRecovery({
      commit: async () => { throw new Error("network down"); },
      rollback: async () => { throw new Error("network down"); },
      isCommitted: async () => { throw new Error("network down"); },
      revokeInvitation,
    });
    expect(resolution).toBe("UNKNOWN");
    expect(revokeInvitation).not.toHaveBeenCalled();
  });
});