import { describe, expect, it } from 'vitest';
import { csvCell, STATUS_META, reconciliationScopeId } from './student-nfc-reconciliation';

describe('student NFC reconciliation helpers', () => {
  it('neutralises spreadsheet formula prefixes', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell('  =SUM(A1)')).toBe("'  =SUM(A1)");
    expect(csvCell('\n=SUM(A1)')).toBe('"\'\n=SUM(A1)"');
  });
  it('never labels review statuses as approval', () => {
    expect(STATUS_META.CANDIDATE_AFTER_REVIEW.detail).toMatch(/Not migration approval/);
    expect(STATUS_META.NEW_OBLIGATION_AFTER_REVIEW.detail).toMatch(/Not migration approval/);
    expect(STATUS_META.OWNER_REVIEW.label).not.toBe(STATUS_META.PRESERVE_COMPLETED_HISTORY.label);
  });
  it('rejects malformed and unsafe scope identifiers',()=>{
    expect(reconciliationScopeId(' 12 ')).toBe(12);
    for(const v of ['0','-1','1.1','1e3','Infinity','9007199254740992',''])expect(reconciliationScopeId(v)).toBeNull();
  });
});
