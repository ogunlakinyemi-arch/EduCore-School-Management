import { describe, expect, it } from 'vitest';
import { schoolCodePreview } from './school-code';

describe('automatic school code preview', () => {
  it('derives a read-only preview within the existing school code format', () => {
    expect(schoolCodePreview('Cedar Grove Academy', 'abcdef')).toBe('CED-ABCDEF');
  });
  it('retains the same code when the same creation form is retried', () => {
    expect(schoolCodePreview('Alpha Academy', '123abc')).toBe(schoolCodePreview('Alpha Academy', '123abc'));
  });
  it('distinguishes similar school names using the form-specific suffix', () => {
    expect(schoolCodePreview('Alpha Academy', '123abc')).not.toBe(schoolCodePreview('Alpha Academy', '456def'));
  });
});