import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/shared';

type SchoolInvitation = {
  invitationId: string;
  email: string;
  fullName: string | null;
  role: 'TEACHER' | 'ACCOUNTANT' | 'PARENT' | 'STUDENT' | 'STAFF';
  status: 'PENDING' | 'EXPIRED' | 'RECOVERY_REQUIRED';
  recoveryAttemptId?: string;
  recoveryState?: string;
  createdAt: string | null;
};

type RowFeedback = { kind: 'success' | 'error'; message: string };

async function schoolInvitationRequest(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || `Invitation request failed (${response.status})`);
  }
  return result;
}

function roleLabel(role: SchoolInvitation['role']) {
  return role === 'STAFF' ? 'School Staff' : role.charAt(0) + role.slice(1).toLowerCase();
}

export function SchoolUserInvitationManagement({ schoolId }: { schoolId: number }) {
  const [invitations, setInvitations] = useState<SchoolInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyInvitationIds, setBusyInvitationIds] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState<Record<string, RowFeedback>>({});
  const [editingInvitationId, setEditingInvitationId] = useState<string | null>(null);
  const [replacementEmail, setReplacementEmail] = useState('');
  const busyInvitationIdsRef = useRef(new Set<string>());

  const loadInvitations = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await schoolInvitationRequest(`/schools/${schoolId}/users/invitations`);
      setInvitations(Array.isArray(response.invitations) ? response.invitations : []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load pending school invitations');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    setIsLoading(true);
    setInvitations([]);
    setFeedback({});
    void loadInvitations();
  }, [loadInvitations]);

  const updateInvitation = async (invitation: SchoolInvitation, kind: 'resend' | 'email') => {
    const invitationId = invitation.invitationId;
    if (busyInvitationIdsRef.current.has(invitationId)) return;
    const email = replacementEmail.trim();
    if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFeedback(current => ({
        ...current,
        [invitationId]: { kind: 'error', message: 'Enter a valid replacement email address.' },
      }));
      return;
    }

    busyInvitationIdsRef.current.add(invitationId);
    setBusyInvitationIds(new Set(busyInvitationIdsRef.current));
    setFeedback(current => {
      const next = { ...current };
      delete next[invitationId];
      return next;
    });
    try {
      const result = await schoolInvitationRequest(
        `/schools/${schoolId}/users/invitations/${encodeURIComponent(invitationId)}${kind === 'resend' ? '/resend' : ''}`,
        kind === 'resend' ? 'POST' : 'PATCH',
        kind === 'resend' ? {} : { email },
      );
      await loadInvitations();
      const replacementId = String(result.invitationId ?? invitationId);
      setFeedback(current => ({
        ...current,
        [replacementId]: {
          kind: 'success',
          message: kind === 'resend'
            ? `Invitation request accepted for ${result.email ?? invitation.email}; inbox delivery is unverified.`
            : `Invitation email updated to ${result.email ?? email}.`,
        },
      }));
      setEditingInvitationId(null);
    } catch (error) {
      setFeedback(current => ({
        ...current,
        [invitationId]: {
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not update this invitation.',
        },
      }));
    } finally {
      busyInvitationIdsRef.current.delete(invitationId);
      setBusyInvitationIds(new Set(busyInvitationIdsRef.current));
    }
  };

  const reconcileInvitation = async (invitation: SchoolInvitation) => {
    const invitationId = invitation.invitationId;
    if (busyInvitationIdsRef.current.has(invitationId)) return;
    busyInvitationIdsRef.current.add(invitationId);
    setBusyInvitationIds(new Set(busyInvitationIdsRef.current));
    setFeedback(current => {
      const next = { ...current };
      delete next[invitationId];
      return next;
    });
    try {
      const result = await schoolInvitationRequest(
        `/schools/${schoolId}/users/invitations/${encodeURIComponent(invitationId)}/reconcile`,
        'POST',
        {},
      );
      await loadInvitations();
      const replacementId = String(result.invitationId ?? invitationId);
      setFeedback(current => ({
        ...current,
        [replacementId]: {
          kind: result.status === 'RECOVERY_REQUIRED' ? 'error' : 'success',
          message: result.status === 'RECOVERY_REQUIRED'
            ? `Provider outcome remains unresolved (${result.recoveryState}); no new invitation was sent.`
            : result.status === 'PENDING'
              ? `Invitation request accepted for ${result.email ?? invitation.email}; inbox delivery is unverified.`
              : `Replacement invitation was reconciled for ${invitation.email}; no new invitation was sent.`,
        },
      }));
    } catch (error) {
      setFeedback(current => ({
        ...current,
        [invitationId]: {
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not reconcile this invitation.',
        },
      }));
    } finally {
      busyInvitationIdsRef.current.delete(invitationId);
      setBusyInvitationIds(new Set(busyInvitationIdsRef.current));
    }
  };

  return (
    <section
      aria-label="Pending school user invitations"
      className="panel mb-6 overflow-hidden"
    >
      <div className="border-b border-[hsl(var(--border))] px-5 py-4 md:px-6">
        <h2 className="text-sm font-bold text-[hsl(var(--foreground))]">Pending school invitations</h2>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          Manage individual Teacher, Accountant, Parent, Student, and School Staff invitations.
        </p>
      </div>
      {isLoading ? (
        <p role="status" className="px-5 py-5 text-sm text-[hsl(var(--muted-foreground))]">Loading invitations…</p>
      ) : loadError ? (
        <div className="px-5 py-5">
          <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{loadError}</p>
          <Button type="button" variant="outline" className="mt-3" onClick={() => void loadInvitations()}>Try again</Button>
        </div>
      ) : invitations.length === 0 ? (
        <p className="px-5 py-5 text-sm text-[hsl(var(--muted-foreground))]">
          No pending, expired, or recovery-required school-user invitations. Accepted and registered users are not shown here.
        </p>
      ) : (
        <ul>
          {invitations
            .filter(invitation =>
              Boolean(invitation.invitationId) &&
              (invitation.status === 'PENDING' ||
                invitation.status === 'EXPIRED' ||
                invitation.status === 'RECOVERY_REQUIRED')
            )
            .map(invitation => {
            const busy = busyInvitationIds.has(invitation.invitationId);
            const isEditing = editingInvitationId === invitation.invitationId;
            const rowFeedback = feedback[invitation.invitationId];
            return (
              <li
                key={invitation.invitationId}
                aria-label={`${roleLabel(invitation.role)} invitation for ${invitation.email}`}
                className="grid gap-4 border-b border-[hsl(var(--border)/.6)] px-5 py-5 last:border-0 md:grid-cols-[1.5fr_1fr_1fr_auto] md:items-start md:px-6"
              >
                <div>
                  <div className="text-sm font-bold text-[hsl(var(--foreground))]">
                    {invitation.fullName || invitation.email}
                  </div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{invitation.email}</div>
                  {invitation.createdAt && (
                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                      Requested {new Date(invitation.createdAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <div>
                  <span className="rounded border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.1)] px-2 py-0.5 text-[10px] font-bold text-[hsl(var(--primary))]">
                    {roleLabel(invitation.role)}
                  </span>
                </div>
                <div className="text-xs font-bold">{invitation.status}</div>
                {invitation.status === 'RECOVERY_REQUIRED' ? (
                  <div className="space-y-2 md:justify-self-end">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {invitation.recoveryState === 'DISPATCH_REJECTED'
                        ? 'Clerk definitely rejected the staged request. The old invitation was revoked; retrying here safely reuses the same replacement attempt.'
                        : invitation.recoveryState === 'REVOCATION_REJECTED'
                          ? 'Clerk rejected revoking the selected invitation. No replacement was sent; retrying here rechecks and safely retries revocation.'
                          : invitation.recoveryState === 'PREPARED' || invitation.recoveryState === 'REVOCATION_UNKNOWN'
                            ? 'No replacement notification was dispatched. Retrying first verifies the selected invitation and then safely resumes its staged send.'
                            : `Provider outcome ${invitation.recoveryState?.toLowerCase().replaceAll('_', ' ') ?? 'unknown'}; fresh sends are blocked.`}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      aria-label={`Reconcile delivery for ${invitation.email}`}
                      onClick={() => void reconcileInvitation(invitation)}
                    >
                      {busy
                        ? 'Checking…'
                        : invitation.recoveryState === 'DISPATCH_REJECTED' || invitation.recoveryState === 'REVOCATION_REJECTED'
                          ? 'Retry staged attempt'
                          : 'Reconcile delivery'}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      aria-label={`Resend Link for ${invitation.email}`}
                      onClick={() => void updateInvitation(invitation, 'resend')}
                    >
                      {busy ? 'Working…' : 'Resend Link'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      aria-label={`Edit email for ${invitation.email}`}
                      onClick={() => {
                        setEditingInvitationId(isEditing ? null : invitation.invitationId);
                        setReplacementEmail(invitation.email);
                      }}
                    >
                      {isEditing ? 'Cancel edit' : 'Edit email'}
                    </Button>
                  </div>
                )}
                {isEditing && invitation.status !== 'RECOVERY_REQUIRED' && (
                  <div className="space-y-2 md:col-span-4">
                    <label className="block text-xs font-bold text-[hsl(var(--muted-foreground))]">
                      Replacement email
                      <input
                        type="email"
                        value={replacementEmail}
                        onChange={event => setReplacementEmail(event.target.value)}
                        className="mt-1 w-full"
                        aria-label={`Replacement email for ${invitation.email}`}
                      />
                    </label>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => void updateInvitation(invitation, 'email')}
                    >
                      {busy ? 'Updating…' : 'Save email and send replacement'}
                    </Button>
                  </div>
                )}
                {rowFeedback && (
                  <p
                    role={rowFeedback.kind === 'error' ? 'alert' : 'status'}
                    className={`text-xs md:col-span-4 ${rowFeedback.kind === 'error' ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--primary))]'}`}
                  >
                    {rowFeedback.message}
                  </p>
                )}
              </li>
            );
            })}
        </ul>
      )}
    </section>
  );
}