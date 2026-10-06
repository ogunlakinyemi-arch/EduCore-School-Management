import { describe, expect, it, vi } from 'vitest';

vi.mock('@workspace/api-client-react', () => ({}));
vi.mock('@tanstack/react-query', () => ({}));
vi.mock('@clerk/react', () => ({ useAuth: () => ({ userId: 'u1' }) }));
vi.mock('@/components/shared', () => ({ money: (n: number) => n.toLocaleString('en-NG') }));

import {
  getStudentNfcObligationsQueryKey,
  getStudentNfcObligationsUrl,
  minorToNaira,
  nfcStatusLabel,
} from './student-nfc-obligations';

describe('student NFC obligations contract', () => {
  it('builds the scoped URL with only supplied filters', () => {
    expect(getStudentNfcObligationsUrl()).toBe('/api/student-nfc/obligations');
    expect(getStudentNfcObligationsUrl({ studentId: 721, termId: 20 }))
      .toBe('/api/student-nfc/obligations?studentId=721&termId=20');
  });

  it('keys cache by identity so users never share data', () => {
    expect(getStudentNfcObligationsQueryKey('user:PARENT@1', { studentId: 5 }))
      .not.toEqual(getStudentNfcObligationsQueryKey('user:STUDENT@1', { studentId: 5 }));
  });

  it('labels legacy review as Owner review and never as paid', () => {
    expect(nfcStatusLabel.LEGACY_REVIEW).toBe('Owner review');
    expect(nfcStatusLabel.LEGACY_REVIEW).not.toBe(nfcStatusLabel.PAID);
  });

  it('formats the fixed split from minor units', () => {
    expect(minorToNaira(200000)).toContain('2,000');
    expect(minorToNaira(300000)).toContain('3,000');
  });
});
