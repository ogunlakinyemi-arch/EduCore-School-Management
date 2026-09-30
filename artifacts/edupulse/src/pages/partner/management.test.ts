import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./management.tsx', import.meta.url), 'utf8');

describe('Owner partner invitation management', () => {
  it('loads platform invitation rows and makes invitation state explicit', () => {
    expect(source).toContain("'/platform/partners/invitations'");
    expect(source).toContain("status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'DISPATCHING' | 'UNKNOWN_PROVIDER_STATE' | 'FAILED' | 'RATE_LIMITED'");
    expect(source).toContain('Invitation: {label}');
    expect(source).toContain("partner.status === 'INVITED' ? 'PENDING' : partner.status");
    expect(source).toContain("status === 'PENDING' ? 'Pending' : status === 'ACTIVE' ? 'Active' :");
    expect(source).toContain("status === 'DISPATCHING' ? 'Dispatch in progress'");
    expect(source).toContain("status === 'UNKNOWN_PROVIDER_STATE' ? 'Provider state unknown'");
    expect(source).toContain("status === 'RATE_LIMITED' ? 'Rate limited'");
  });

  it('edits pending invitation email through the partner PATCH contract', () => {
    expect(source).toContain('`/platform/partners/${partnerId}`');
    expect(source).toContain("method: 'PATCH'");
    expect(source).toContain('JSON.stringify({ email })');
    expect(source).toContain("invitationStatus === 'PENDING' || invitationStatus === 'EXPIRED'");
    expect(source).toContain("{invitationStatus === 'PENDING' && <Button");
    expect(source).toContain('Saving updates the partner email and supersedes the previous invitation.');
  });

  it('resends using the replacement invitation endpoint and refreshes after mutations', () => {
    expect(source).toContain('`/platform/partners/${partnerId}/invitations/resend`');
    expect(source).toContain("method: 'POST'");
    expect(source).toContain('body: JSON.stringify({})');
    expect(source).toContain("invitationStatus === 'DISPATCHING' || invitationStatus === 'UNKNOWN_PROVIDER_STATE'");
    expect(source).toContain("isUnresolved ? 'Retry reconciliation' : 'Resend'");
    expect(source).toContain('resendInvitation.mutate({ partnerId: partner.id, reconcile: isUnresolved })');
    expect(source).toContain('Provider state is unresolved. Do not send another invitation; reconcile the existing attempt.');
    expect(source).toContain('No blind resend was attempted; use Retry reconciliation again when provider state is available.');
    expect(source).toContain("const canResendInvitation = invitationStatus === 'PENDING' || invitationStatus === 'EXPIRED' ||");
    expect(source).toContain("invitationStatus === 'FAILED' || invitationStatus === 'RATE_LIMITED'");
    expect(source).toContain('const canManageInvitation = canResendInvitation || isUnresolved');
    expect(source).toContain('Resend is available; the server enforces the provider cooldown.');
    expect(source).toContain("isUnresolved ? 'Retry reconciliation' : 'Resend'");
    expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['platformPartnerInvitations'] })");
    expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['listPartners'] })");
  });

  it('surfaces request failures and offers a refresh when invitation status cannot load', () => {
    expect(source).toContain("title: 'Email update failed'");
    expect(source).toContain("reconcile ? 'Invitation remains unresolved' : 'Resend failed'");
    expect(source).toContain('Invitation statuses could not be loaded:');
    expect(source).toContain('onClick={() => invitations.refetch()}');
  });
});