import { describe, expect, it } from 'vitest';
import { buildSyllabusOverview } from './syllabus-overview';
describe('buildSyllabusOverview', () => {
  it('is empty without source topics', () => expect(buildSyllabusOverview([], null)).toBe(''));
  it('orders official topics, skips school additions and cites the version', () => {
    const out = buildSyllabusOverview([
      { title: 'B', sequenceOrder: 2 }, { title: 'Ours', sourceKind: 'SCHOOL_SPECIFIC' }, { title: 'A', sequenceOrder: 1, learningObjectives: ['x', 'y'] },
    ], { id: 4, title: 'Basic Science', sourceOrganization: 'NERDC', sourceVersion: '2012' });
    expect(out.startsWith('1. A\n   Objectives: x; y\n2. B')).toBe(true);
    expect(out).not.toContain('Ours');
    expect(out).toContain('Source: Basic Science, NERDC 2012 (version #4)');
  });
});
