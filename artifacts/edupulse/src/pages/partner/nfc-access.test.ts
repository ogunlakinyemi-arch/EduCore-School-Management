import { describe, expect, it } from 'vitest';
import { canAssign } from './nfc-access';

const base = { allowed: true, schoolsError: false, studentsError: false, cardsError: false, schoolEligible: true, studentId: 1, cardNumber: 'CARD-0001', pending: false };
describe('canAssign', () => {
  it('allows a complete valid selection', () => expect(canAssign(base)).toBe(true));
  it.each([
    { allowed: false }, { schoolsError: true }, { studentsError: true }, { cardsError: true },
    { schoolEligible: false }, { studentId: null }, { cardNumber: 'ab' }, { cardNumber: 'bad card!' }, { pending: true },
  ])('blocks %o', patch => expect(canAssign({ ...base, ...patch })).toBe(false));
});
