import { describe, expect, it } from 'vitest';
import { shouldEndPreviousSignInSession } from './sign-in-session-policy';

describe('sign-in session retention', () => {
  it('does not sign out a session completed after entering signed out', () => {
    expect(shouldEndPreviousSignInSession(false, false)).toBe(false);
  });

  it('preserves the existing account-switch behavior for a previous session', () => {
    expect(shouldEndPreviousSignInSession(true, false)).toBe(true);
  });

  it('retains a previous session for verified invitation acceptance', () => {
    expect(shouldEndPreviousSignInSession(true, true)).toBe(false);
  });

  it('retains a newly completed invitation sign-in', () => {
    expect(shouldEndPreviousSignInSession(false, true)).toBe(false);
  });
});