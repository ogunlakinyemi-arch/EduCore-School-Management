// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AcademicReportDocument, componentColumns, reportColors } from './academic-report-document';
import { buildPrintableDocumentHtml, createPrintFrame, settlePrintDocument, SCHOOL_DOCUMENT_PRINT_CSS } from './school-document';

const branding = { name: 'Harmattan Ridge College', logoUrl: '/api/schools/4/branding/logo', phone: '0803 114 2290', email: 'office@harmattanridge.edu.ng', primaryColor: '#0b4f6c', secondaryColor: '#c9a227' };
const card = {
  id: 77, status: 'PUBLISHED', studentName: 'Ifeoma Adeyemi-Okafor', admissionNo: 'HRC/2291', className: 'JSS2', section: 'Gold',
  sessionName: '2025/2026', termName: 'Second Term', studentPhotoUrl: '/api/students/12/photo',
  consolidatedSubjects: [
    { subjectId: 1, subjectName: 'Mathematics', score: 71.5, maxScore: 100, grade: 'B2', remark: 'Very good', components: [{ label: 'CA1', score: 16, maxScore: 20 }, { label: 'Exam', score: 55.5, maxScore: 80 }] },
    { subjectId: 2, subjectName: 'Basic Science', score: 63, maxScore: 100, grade: 'C4', components: [{ label: 'CA1', score: 12, maxScore: 20 }, { label: 'Exam', score: 51, maxScore: 80 }] },
  ],
  total: 134.5, average: 67.25, attendance: { present: 58, late: 3, absent: 2, total: 63 },
  teacherRemark: 'Steady progress in numeracy.', schoolRemark: 'Promising term.', lines: [],
};

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('academic report document', () => {
  it('uses the school identity, colours and the child stored photo only', () => {
    const html = renderToStaticMarkup(<AcademicReportDocument card={card} branding={branding} />);
    expect(html).toContain('Harmattan Ridge College');
    expect(html).toContain('--report-primary:#0b4f6c');
    expect(html).toContain('--report-secondary:#c9a227');
    expect(html).toContain('src="/api/schools/4/branding/logo"');
    expect(html).toContain('src="/api/students/12/photo"');
    expect(html.match(/<img/g)).toHaveLength(2);
    expect(html).not.toMatch(/placeholder|avatar|EduCore|Yetenia/i);
  });
  it('omits photo when absent or cross-origin and falls back to neutral colours', () => {
    const noPhoto = renderToStaticMarkup(<AcademicReportDocument card={{ ...card, studentPhotoUrl: undefined }} branding={{ name: 'Harmattan Ridge College' }} />);
    expect(noPhoto).not.toContain('academic-report-student-photo');
    expect(noPhoto).not.toContain('<img');
    expect(reportColors({ primaryColor: 'red' })).toEqual({ primary: '#27313f', secondary: '#8a6d3b' });
    const foreign = renderToStaticMarkup(<AcademicReportDocument card={{ ...card, studentPhotoUrl: 'https://elsewhere.example/p.jpg' }} branding={branding} />);
    expect(foreign).not.toContain('academic-report-student-photo');
  });
  it('maps consistent named components to columns and never invents grades', () => {
    expect(componentColumns(card.consolidatedSubjects)).toEqual(['CA1', 'Exam']);
    const html = renderToStaticMarkup(<AcademicReportDocument card={card} branding={branding} />);
    expect(html).toContain('<thead>');
    expect(html).toMatch(/<th class="num">CA1<\/th><th class="num">Exam<\/th>/);
    expect(html).toContain('55.5/80');
    expect(html).toContain('B2');
    expect(html).not.toContain('Next term begins');
    const mixed = [card.consolidatedSubjects[0], { ...card.consolidatedSubjects[1], components: [{ label: 'Project', score: 9, maxScore: 10 }] }];
    expect(componentColumns(mixed)).toBeNull();
    const mixedHtml = renderToStaticMarkup(<AcademicReportDocument card={{ ...card, consolidatedSubjects: mixed }} branding={branding} />);
    expect(mixedHtml).toContain('Project: 9/10');
  });
  it('falls back to published lines', () => {
    const html = renderToStaticMarkup(<AcademicReportDocument card={{ ...card, consolidatedSubjects: [], lines: [{ id: 3, subjectName: 'English', assessmentName: 'Term exam', score: 48, maxScore: 60, grade: 'B3', remark: '' }] }} branding={branding} />);
    expect(html).toContain('academic-report-lines');
    expect(html).toContain('48/60');
  });
});

describe('isolated print surface', () => {
  it('produces a standalone visible A4 document with repeating table headers', () => {
    const body = renderToStaticMarkup(<AcademicReportDocument card={card} branding={branding} />);
    const html = buildPrintableDocumentHtml({ bodyHtml: body, title: 'Report card' });
    expect(html).toContain('@page { size: A4');
    expect(SCHOOL_DOCUMENT_PRINT_CSS).toContain('thead { display: table-header-group; }');
    expect(SCHOOL_DOCUMENT_PRINT_CSS).toMatch(/tr[^{]*\{ break-inside: avoid/);
    expect(html).not.toContain('school-document-source');
    expect(html).not.toMatch(/display:\s*none[^;]*;\s*}\s*$/);
    expect(html).toContain('Ifeoma Adeyemi-Okafor');
  });
  it('renders into an attached, non-hidden iframe with content', async () => {
    const frame = createPrintFrame(buildPrintableDocumentHtml({ bodyHtml: '<article class="school-document-page">Report body</article>', title: 'T' }));
    expect(frame.isConnected).toBe(true);
    expect(frame.style.display).toBe('block');
    expect(frame.hasAttribute('hidden')).toBe(false);
    const root = frame.contentDocument!.querySelector('[data-school-print-root]')!;
    expect(root.textContent).toContain('Report body');
    await settlePrintDocument(frame.contentDocument!, 50);
  });
  it('refuses to print a blank document and reports it', async () => {
    const frame = createPrintFrame(buildPrintableDocumentHtml({ bodyHtml: '   ', title: 'T' }));
    await expect(settlePrintDocument(frame.contentDocument!, 50)).rejects.toThrow(/empty/);
  });
  it('drops an unloadable optional photo but fails on an unloadable logo', async () => {
    const photoFrame = createPrintFrame(buildPrintableDocumentHtml({ bodyHtml: '<p>Text</p><figure data-print-optional="photo"><img src="/x.jpg"></figure>', title: 'T' }));
    await settlePrintDocument(photoFrame.contentDocument!, 20);
    expect(photoFrame.contentDocument!.querySelector('figure')).toBeNull();
    const logoFrame = createPrintFrame(buildPrintableDocumentHtml({ bodyHtml: '<p>Text</p><img data-print-required="logo" src="/l.png">', title: 'T' }));
    await expect(settlePrintDocument(logoFrame.contentDocument!, 20)).rejects.toThrow(/logo/);
  });
});
