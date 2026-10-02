import { describe, expect, it } from 'vitest';
import { suggestVersions, missingForSubmit, isEditableStatus, isPendingReview, isConflict, cleanMapping, cleanContent, levelMatches, splitLines } from './curriculum-kit';

const v = (id: number, status: string, classLevels: string[], subjectCodes: string[]) => ({ id, status, classLevels, subjectCodes });

describe('curriculum kit', () => {
  it('suggests published versions matching exact normalized class and subject code or name', () => {
    const list = [
      v(1, 'PUBLISHED', ['JSS1'], ['MTH']),
      v(2, 'DRAFT', ['JSS1'], ['MTH']),
      v(3, 'PUBLISHED', ['SSS1'], ['MTH']),
      v(4, 'PUBLISHED', [], ['mth']),
      v(5, 'PUBLISHED', ['JSS 2'], ['Mathematics']),
      v(6, 'PUBLISHED', ['JSS 20'], ['MTH']),
      v(7, 'PUBLISHED', ['JSS 2'], ['Physics']),
    ];
    expect(suggestVersions(list, { name: 'JSS 1' }, { code: 'mth' }).map(x => x.id)).toEqual([1, 4]);
    expect(suggestVersions(list, { name: 'JSS2' }, { code: 'MAT', name: 'Mathematics' }).map(x => x.id)).toEqual([5]);
    expect(suggestVersions(list, undefined, { code: 'MTH' })).toEqual([]);
  });
  it('matches class levels', () => {
    expect(levelMatches('JSS2', ['JSS 2'])).toBe(true);
    expect(levelMatches('Primary 4 Gold', ['Primary 4'])).toBe(false);
    expect(levelMatches('JSS 2', ['JSS 1'])).toBe(false);
  });
  it('requires topic, objectives and lesson content to submit', () => {
    expect(missingForSubmit({ topic: 'Fractions' })).toEqual(['Objectives', 'Lesson content']);
    expect(missingForSubmit({ topic: 'a', objectives: 'b', lessonContent: 'c' })).toEqual([]);
  });
  it('only draft and returned notes are editable; pending states reviewable', () => {
    expect(['DRAFT', 'RETURNED'].every(isEditableStatus)).toBe(true);
    expect(['SUBMITTED', 'RESUBMITTED', 'APPROVED', 'ARCHIVED'].some(isEditableStatus)).toBe(false);
    expect(isPendingReview('RESUBMITTED')).toBe(true);
    expect(isPendingReview('APPROVED')).toBe(false);
  });
  it('detects revision conflicts and cleans payloads', () => {
    expect(isConflict({ status: 409 })).toBe(true);
    expect(isConflict(new Error('x'))).toBe(false);
    expect(cleanMapping({ title: 'Topic', classLevel: '' })).toEqual({ title: 'Topic' });
    expect(cleanContent({ topic: ' ', objectives: 'x' })).toEqual({ objectives: 'x' });
    expect(splitLines('a\n\n b ')).toEqual(['a', 'b']);
  });
});

import { assignmentCovers } from './curriculum-kit';
describe('assignmentCovers', () => {
  it('null subject covers any subject of the class', () => {
    expect(assignmentCovers({ classId: 3, subjectId: null }, 3, 9)).toBe(true);
    expect(assignmentCovers({ classId: 3, subjectId: 9 }, 3, 9)).toBe(true);
    expect(assignmentCovers({ classId: 3, subjectId: 8 }, 3, 9)).toBe(false);
    expect(assignmentCovers({ classId: 4, subjectId: null }, 3, 9)).toBe(false);
  });
});

import { parentOptions, orderHierarchy } from './curriculum-kit';
describe('sub-topics', () => {
  const t = [
    { id: 1, classLevel: 'JSS1', subjectCode: 'MTH', parentTopicId: null, sequenceOrder: 1 },
    { id: 2, classLevel: 'JSS 2', subjectCode: 'MTH', parentTopicId: null },
    { id: 3, classLevel: 'JSS1', subjectCode: 'ENG', parentTopicId: null },
    { id: 4, classLevel: 'JSS1', subjectCode: 'MTH', parentTopicId: 1 },
  ];
  it('offers only same class and subject main topics as parents', () => {
    expect(parentOptions(t, 'JSS 1', 'mth').map(x => x.id)).toEqual([1]);
  });
  it('orders children under parents', () => {
    const o = orderHierarchy(t).map(x => x.topic.id);
    expect(o.indexOf(4)).toBe(o.indexOf(1) + 1);
  });
});
