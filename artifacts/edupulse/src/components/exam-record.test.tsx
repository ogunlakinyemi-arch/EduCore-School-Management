import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { applyPasteGrid, cellError, parseClipboardGrid, SheetActions, SheetBanners, isEditableStatus, ComponentsPanel, retainComponentCells, nextComponentKey } from '@/components/exam-record-sheet';
import { paperCapabilities } from '@/components/exam-record-questions';
import { PublishedReports } from '@/components/exam-record-family';
import { resolveSurfaceRole, StudentPreviewBody } from '@/pages/exam-record';

const noop = () => {};
const wrap = (n: React.ReactNode) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>);

describe('worksheet component configuration', () => {
  const component = { key: 'ca1', label: 'CA1', typeId: 3, maxScore: 20, assessmentId: null };
  it('keeps null or omitted assessment IDs editable and saved assessment IDs immutable', () => {
    const markup = (assessmentId: number | null | undefined) => renderToStaticMarkup(<ComponentsPanel comps={[{ ...component, assessmentId } as any]} types={[{ id: 3, name: 'Test', maxScore: null }]} onChange={noop} />);
    for (const id of [null, undefined]) {
      expect(markup(id)).toContain('button-er-remove-component-0');
      expect(markup(id)).not.toContain('>Saved</span>');
    }
    expect(markup(42)).not.toContain('button-er-remove-component-0');
    expect(markup(42)).toContain('>Saved</span>');
  });
  it('drops removed draft-column marks without changing remaining students or columns', () => {
    expect(retainComponentCells({ 721: { ca1: '16', discarded: '99' }, 730: { ca1: '' } }, [component]))
      .toEqual({ 721: { ca1: '16' }, 730: { ca1: '' } });
  });
  it('does not recycle removed keys when the used-key history is supplied', () => {
    expect(nextComponentKey([{ key: 'type3' }, { key: 'new-2' }, { key: 'new-3' }])).toBe('new-4');
  });
});

describe('spreadsheet paste and validation', () => {
  const rows = [{ studentId: 1 }, { studentId: 2 }];
  const comps = [{ key: 'ca' }, { key: 'exam' }];
  it('parses only multi-cell clipboard text', () => {
    expect(parseClipboardGrid('12')).toBeNull();
    expect(parseClipboardGrid('1\t2\r\n3\t4\r\n')).toEqual([['1', '2'], ['3', '4']]);
  });
  it('applies a rectangle from the anchor and drops overflow', () => {
    const out = applyPasteGrid({}, rows, comps, 1, 1, [['5', '6'], ['7', '8']]);
    expect(out[2].exam).toBe('5');
    expect(out[1]).toBeUndefined();
  });
  it('rejects non-numeric and out of range values, allows blanks', () => {
    expect(cellError('', 20)).toBe('');
    expect(cellError('1e3', 20)).toBe('Numbers only');
    expect(cellError('-1', 20)).toBe('Numbers only');
    expect(cellError('21', 20)).toBe('Max 20');
    expect(cellError('20', 20)).toBe('');
    expect(cellError('99', null)).toBe('');
  });
});

describe('locked and returned sheets', () => {
  const actions = (editable: boolean) => renderToStaticMarkup(<SheetActions editable={editable} busy={false} dirty onTemplate={noop} onUpload={noop} onSave={noop} onSubmit={noop} />);
  it('shows entry controls only when editable', () => {
    expect(actions(true)).toContain('Submit result');
    expect(actions(false)).toBe('');
    for (const s of ['SUBMITTED', 'RESUBMITTED', 'PUBLISHED', 'LOCKED', 'APPROVED']) expect(isEditableStatus(s)).toBe(false);
    expect(isEditableStatus('RETURNED')).toBe(true);
  });
  it('shows the return reason and keeps returned editable', () => {
    const html = renderToStaticMarkup(<SheetBanners status="RETURNED" comment="Recheck row 4" />);
    expect(html).toContain('Recheck row 4');
    expect(html).not.toContain('read-only');
    expect(renderToStaticMarkup(<SheetBanners status="SUBMITTED" comment={null} />)).toContain('read-only');
  });
});

const student = { studentId: 1, studentName: 'Ada Eze', admissionNo: 'A1', className: 'JSS1', section: 'A', complete: false, subjects: [{ subjectId: 1, subjectName: 'Maths', teacherName: 'T', score: 50, maxScore: 100, grade: 'C', gradePoint: null, missing: false, status: 'SUBMITTED', resultIds: [] }], missingSubjects: ['Chemistry'], total: 50, average: 50, reportCardId: null, status: 'AWAITING' as const, teacherRemark: 'Good', schoolRemark: null, attendance: { present: 50, absent: 3, late: 1, total: 54 } };

describe('admin and owner surfaces', () => {
  const preview = (readOnly: boolean) => wrap(<StudentPreviewBody schoolId={1} params={{}} student={student} readOnly={readOnly} onClose={noop} onPublished={noop} />);
  it('admin previews and publishes but has no score entry or upload', () => {
    const html = preview(false);
    expect(html).toContain('Publish Result');
    expect(html).toContain('Chemistry result has not been submitted by the assigned teacher.');
    expect(html).toContain('50 present');
    expect(html).not.toMatch(/Enter Result|Upload Excel|Result template|Submit result/);
  });
  it('owner gets no publish, no print and no mutation', () => {
    const html = preview(true);
    expect(html).not.toMatch(/Publish Result|Print preview|Return/);
    expect(html).toContain('er-preview-readonly');
  });
  it('owner wins over secondary roles', () => {
    expect(resolveSurfaceRole({ isPlatformOwner: true, roles: [{ role: 'SCHOOL_ADMIN', status: 'ACTIVE' }, { role: 'STUDENT', status: 'ACTIVE' }] })).toBe('OWNER');
    expect(resolveSurfaceRole({ roles: [{ role: 'STUDENT', status: 'ACTIVE' }] })).toBe('FAMILY');
    expect(resolveSurfaceRole({ roles: [{ role: 'TEACHER', status: 'ACTIVE' }, { role: 'STUDENT', status: 'ACTIVE' }] })).toBe('STAFF');
  });
  it('question capabilities: admin reviews and prints, teacher edits, owner nothing', () => {
    expect(paperCapabilities('ADMIN', 'SUBMITTED')).toEqual({ canEdit: false, canReview: true, canPrint: false });
    expect(paperCapabilities('ADMIN', 'APPROVED').canPrint).toBe(true);
    expect(paperCapabilities('TEACHER', 'RETURNED')).toEqual({ canEdit: true, canReview: false, canPrint: false });
    expect(paperCapabilities('TEACHER', 'APPROVED').canPrint).toBe(false);
    expect(paperCapabilities('OWNER', 'APPROVED')).toEqual({ canEdit: false, canReview: false, canPrint: false });
    expect(paperCapabilities('OWNER', 'SUBMITTED').canReview).toBe(false);
  });
});

describe('family view', () => {
  it('shows a clear message and no questions when nothing is published', () => {
    const html = wrap(<PublishedReports cards={[{ id: 1, status: 'DRAFT', className: 'JSS1' }]} schoolId={1} />);
    expect(html).toContain('This result has not been published yet.');
    expect(html).not.toMatch(/Question|JSS1/);
  });
  it('renders published consolidated subjects', () => {
    const html = wrap(<PublishedReports cards={[{ id: 2, status: 'PUBLISHED', className: 'JSS1', consolidatedSubjects: [{ subjectId: 1, subjectName: 'Maths', score: 70, maxScore: 100, grade: 'B' }], total: 70, average: 70 }]} schoolId={1} />);
    expect(html).toContain('Maths');
    expect(html).not.toMatch(/Question/);
  });
});
