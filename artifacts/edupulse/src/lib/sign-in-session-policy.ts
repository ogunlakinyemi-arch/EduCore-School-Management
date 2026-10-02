/**
 * An ordinary sign-in page may end a session that was already active when
 * the page opened (the existing account-switch flow), never one created
 * by the sign-in being completed on that page. Invitations retain their
 * own verified-recipient acceptance flow.
 */
export function shouldEndPreviousSignInSession(
  signedInOnEntry: boolean,
  hasInvitation: boolean,
): boolean {
  return signedInOnEntry && !hasInvitation;
}