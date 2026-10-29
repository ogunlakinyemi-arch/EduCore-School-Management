import type { CSSProperties } from 'react';
import { SchoolDocumentPrintButton, sameOriginUrl, useSchoolDocumentBranding, type DocumentBranding } from '@/components/school-document';

/* Shared, branded academic report card. Renders only stored/published values: no grade recalculation, no invented data. */

const NEUTRAL_PRIMARY = '#27313f';
const NEUTRAL_SECONDARY = '#8a6d3b';
const HEX = /^#[0-9a-fA-F]{6}$/;

export function reportColors(branding: DocumentBranding) {
  const primary = typeof branding.primaryColor === 'string' && HEX.test(branding.primaryColor) ? branding.primaryColor : NEUTRAL_PRIMARY;
  const secondary = typeof branding.secondaryColor === 'string' && HEX.test(branding.secondaryColor) ? branding.secondaryColor : NEUTRAL_SECONDARY;
  return { primary, secondary };
}

type Component = { label?: string; name?: string; score?: number | string | null; maxScore?: number | string | null };
const compLabel = (c: Component) => (c.label ?? c.name ?? '').toString().trim();
const has = (v: unknown) => v !== null && v !== undefined && v !== '';
const fmt = (score: unknown, max: unknown) => !has(score) ? '' : has(max) ? `${score}/${max}` : `${score}`;

/** Shared component column labels when every subject records the same named components in the same order; otherwise null. */
export function componentColumns(subjects: any[]): string[] | null {
  if (!subjects.length) return null;
  const first = (subjects[0].components ?? []).map(compLabel);
  if (!first.length || first.some((l: string) => !l) || new Set(first).size !== first.length) return null;
  for (const s of subjects) {
    const labels = (s.components ?? []).map(compLabel);
    if (labels.length !== first.length || labels.some((l: string, i: number) => l !== first[i])) return null;
  }
  return first;
}

type Rating = { label: string; value: string };
function ratings(value: unknown): Rating[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => {
    if (!item || typeof item !== 'object') return [];
    const label = item.label ?? item.name ?? item.trait;
    const v = item.rating ?? item.value ?? item.score ?? item.grade;
    return typeof label === 'string' && label.trim() && has(v) ? [{ label: label.trim(), value: String(v) }] : [];
  });
}

function formatDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function AcademicReportDocument({ card, branding, student }: { card: any; branding: DocumentBranding; student?: { name?: string; admissionNo?: string } }) {
  const { primary, secondary } = reportColors(branding);
  const logoUrl = sameOriginUrl(branding.logoUrl);
  const invalidLogo = !!branding.logoUrl && !logoUrl;
  const photoUrl = sameOriginUrl(card.studentPhotoUrl);
  const studentName = card.studentName || student?.name;
  const admissionNo = card.admissionNo || student?.admissionNo;
  const subjects: any[] = card.consolidatedSubjects?.length ? card.consolidatedSubjects : [];
  const lines: any[] = !subjects.length && card.lines?.length ? card.lines : [];
  const cols = componentColumns(subjects);
  const showSubjectRemark = subjects.some(s => has(s.remark));
  const showLineRemark = lines.some(l => has(l.remark));
  const contact = [branding.address, [branding.city, branding.state].filter(Boolean).join(', '), branding.phone, branding.email, branding.website]
    .filter((v): v is string => typeof v === 'string' && !!v.trim());
  const affective = ratings(card.affective ?? card.affectiveTraits ?? card.affectiveDomain);
  const psychomotor = ratings(card.psychomotor ?? card.psychomotorSkills ?? card.psychomotorDomain);
  const nextTerm = formatDate(card.nextTermDate ?? card.nextTermBegins);
  const att = card.attendance;
  const style = { '--report-primary': primary, '--report-secondary': secondary } as CSSProperties;

  return (
    <article className="school-document-page academic-report" style={style} data-testid={`academic-report-document-${card.id}`}>
      <header className="academic-report-masthead">
        {logoUrl && <img className="academic-report-logo" data-print-required="logo" src={logoUrl} alt={`${branding.name || 'School'} logo`} />}
        <div className="academic-report-school">
          {branding.name && <h1 data-testid="academic-report-school-name">{branding.name}</h1>}
          {contact.length > 0 && <p>{contact.join('  |  ')}</p>}
          {invalidLogo && <p data-school-logo-invalid="true" className="school-document-error">The school logo URL is not same-origin and cannot be included in a secure printout.</p>}
        </div>
        <div className="academic-report-seal">
          <span>Report card</span>
          {card.termName && <strong>{card.termName}</strong>}
          {card.sessionName && <span>{card.sessionName}</span>}
        </div>
      </header>

      <section className="academic-report-block academic-report-student">
        <dl className="academic-report-facts">
          {studentName && <div><dt>Student</dt><dd>{studentName}</dd></div>}
          {admissionNo && <div><dt>Admission no.</dt><dd>{admissionNo}</dd></div>}
          {card.className && <div><dt>Class</dt><dd>{card.className}{card.section ? ` / ${card.section}` : ''}</dd></div>}
          <div><dt>Session</dt><dd>{card.sessionName ?? `Session #${card.sessionId}`}</dd></div>
          <div><dt>Term</dt><dd>{card.termName ?? `Term #${card.termId}`}</dd></div>
          {card.publishedAt && <div><dt>Published</dt><dd>{formatDate(card.publishedAt)}</dd></div>}
        </dl>
        {photoUrl && <figure className="academic-report-photo" data-print-optional="photo"><img src={photoUrl} alt={studentName ? `${studentName} photo` : 'Student photo'} data-testid="academic-report-student-photo" /></figure>}
      </section>

      <h2 className="academic-report-heading">Subject performance</h2>
      {subjects.length ? (
        <table className="school-document-table academic-report-table" data-testid="academic-report-subjects">
          <thead><tr>
            <th>Subject</th>
            {cols ? cols.map(c => <th key={c} className="num">{c}</th>) : <th>Components</th>}
            <th className="num">Total</th><th className="num">Grade</th>
            {showSubjectRemark && <th>Remark</th>}
          </tr></thead>
          <tbody>{subjects.map((s, i) => (
            <tr key={s.subjectId ?? i}>
              <td className="subject">{s.subjectName}</td>
              {cols ? cols.map((_, ci) => { const c = (s.components ?? [])[ci] ?? {}; return <td key={ci} className="num">{fmt(c.score, c.maxScore)}</td>; })
                : <td>{(s.components ?? []).filter((c: Component) => compLabel(c)).map((c: Component) => `${compLabel(c)}: ${fmt(c.score, c.maxScore)}`).join('; ')}</td>}
              <td className="num strong">{fmt(s.score, s.maxScore)}</td>
              <td className="num strong">{s.grade ?? ''}</td>
              {showSubjectRemark && <td>{s.remark ?? ''}</td>}
            </tr>
          ))}</tbody>
        </table>
      ) : lines.length ? (
        <table className="school-document-table academic-report-table" data-testid="academic-report-lines">
          <thead><tr><th>Subject</th><th>Assessment</th><th className="num">Score</th><th className="num">Grade</th>{showLineRemark && <th>Remark</th>}</tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={l.id ?? i}><td className="subject">{l.subjectName}</td><td>{l.assessmentName}</td><td className="num strong">{fmt(l.score, l.maxScore)}</td><td className="num strong">{l.grade ?? ''}</td>{showLineRemark && <td>{l.remark ?? ''}</td>}</tr>
          ))}</tbody>
        </table>
      ) : <p className="academic-report-empty">No graded results were included at publication.</p>}

      {(has(card.total) || has(card.average) || att) && (
        <section className="academic-report-block academic-report-summary">
          {has(card.total) && <div><span>Total score</span><strong>{card.total}</strong></div>}
          {has(card.average) && <div><span>Average</span><strong>{card.average}%</strong></div>}
          {att && has(att.total) && <div><span>Attendance</span><strong>{att.present ?? 0}/{att.total}</strong><em>{att.late ?? 0} late, {att.absent ?? 0} absent</em></div>}
        </section>
      )}

      {(affective.length > 0 || psychomotor.length > 0) && (
        <section className="academic-report-block academic-report-domains">
          {([['Affective traits', affective], ['Psychomotor skills', psychomotor]] as Array<[string, Rating[]]>).map(([title, list]) => list.length ? (
            <table key={title} className="school-document-table academic-report-table">
              <thead><tr><th>{title}</th><th className="num">Rating</th></tr></thead>
              <tbody>{list.map(r => <tr key={r.label}><td>{r.label}</td><td className="num">{r.value}</td></tr>)}</tbody>
            </table>
          ) : null)}
        </section>
      )}

      {(card.teacherRemark || card.schoolRemark) && (
        <section className="academic-report-block academic-report-remarks">
          {card.teacherRemark && <div><h3>Class teacher</h3><p>{card.teacherRemark}</p></div>}
          {card.schoolRemark && <div><h3>School</h3><p>{card.schoolRemark}</p></div>}
        </section>
      )}

      <footer className="academic-report-block academic-report-footer">
        {nextTerm && <p><strong>Next term begins:</strong> {nextTerm}</p>}
        <p>Official record issued by {branding.name || 'the school'} from published results.</p>
      </footer>
    </article>
  );
}

export function AcademicReportPrint({ schoolId, card, testId, label = 'Print report card', student }: { schoolId: number; card: any; testId: string; label?: string; student?: { name?: string; admissionNo?: string } }) {
  const branding = useSchoolDocumentBranding(schoolId);
  const school = branding.data as DocumentBranding | undefined;
  return (
    <SchoolDocumentPrintButton
      label={label}
      title={`Report card${card.studentName || student?.name ? ` - ${card.studentName || student?.name}` : ''}`}
      testId={testId}
      disabled={!school || branding.isLoading || branding.isError}
      unavailableMessage={branding.isError ? 'School branding could not be loaded. Retry before printing this report card.' : 'Loading the selected school identity.'}
    >
      <AcademicReportDocument card={card} branding={school ?? {}} student={student} />
    </SchoolDocumentPrintButton>
  );
}
