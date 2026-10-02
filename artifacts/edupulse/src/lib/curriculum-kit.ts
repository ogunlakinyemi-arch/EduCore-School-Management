export const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Match only identical labels after case, whitespace, and punctuation normalization. */
export function levelMatches(className: string, levels: string[]) {
  const c = norm(className);
  return !!c && levels.some(l => { const n = norm(l); return !!n && c === n; });
}

type VersionLike = { id: number; status: string; classLevels: string[]; subjectCodes: string[] };
export function suggestVersions<T extends VersionLike>(versions: T[], cls: { name: string } | undefined, subject: { code: string; name?: string } | undefined): T[] {
  if (!cls || !subject) return [];
  const subjectAliases = new Set([norm(subject.code), norm(subject.name)].filter(Boolean));
  return versions.filter(v =>
    v.status === 'PUBLISHED' &&
    v.subjectCodes.some(c => subjectAliases.has(norm(c))) &&
    (v.classLevels.length === 0 || levelMatches(cls.name, v.classLevels)));
}

export const NOTE_FIELDS: Array<{ key: string; label: string; required?: boolean; long?: boolean }> = [
  { key: 'topic', label: 'Topic', required: true },
  { key: 'subTopic', label: 'Subtopic' },
  { key: 'objectives', label: 'Objectives', required: true, long: true },
  { key: 'previousKnowledge', label: 'Previous knowledge', long: true },
  { key: 'materials', label: 'Materials', long: true },
  { key: 'introduction', label: 'Introduction', long: true },
  { key: 'lessonDevelopment', label: 'Lesson development', long: true },
  { key: 'teacherActivities', label: 'Teacher activities', long: true },
  { key: 'studentActivities', label: 'Student activities', long: true },
  { key: 'lessonContent', label: 'Lesson content', required: true, long: true },
  { key: 'examples', label: 'Examples', long: true },
  { key: 'classActivities', label: 'Class activities', long: true },
  { key: 'assessment', label: 'Assessment', long: true },
  { key: 'assignment', label: 'Assignment', long: true },
  { key: 'conclusion', label: 'Conclusion', long: true },
  { key: 'references', label: 'References', long: true },
];

export function missingForSubmit(content: Record<string, unknown>) {
  return NOTE_FIELDS.filter(f => f.required && !String(content[f.key] ?? '').trim()).map(f => f.label);
}
export const isEditableStatus = (s?: string) => s === 'DRAFT' || s === 'RETURNED';
export const isPendingReview = (s?: string) => s === 'SUBMITTED' || s === 'RESUBMITTED';
export const splitLines = (v: string) => v.split('\n').map(x => x.trim()).filter(Boolean);
export const joinLines = (v?: string[]) => (v ?? []).join('\n');
export const splitCsv = (v: string) => v.split(',').map(x => x.trim()).filter(Boolean);
export const isConflict = (err: unknown) => (err as { status?: number } | null)?.status === 409;
export const cleanContent = (c: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === 'string' ? v.trim() !== '' : v != null));

export const CANONICAL_IMPORT_FIELDS = ['classLevel', 'subjectCode', 'title', 'learningObjectives', 'learningOutcomes', 'suggestedResources'];
export function cleanMapping(m: Record<string, string>) {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v));
}
export const label = (s?: string | null) => (s ?? '').replaceAll('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());

/** A teacher_class assignment with a null subject covers every subject of that class. */
export const assignmentCovers = (a: { classId?: number | null; subjectId?: number | null }, classId: number, subjectId: number) =>
  a.classId === classId && (a.subjectId == null || a.subjectId === subjectId);

type TopicLike = { id: number; classLevel: string; subjectCode: string; parentTopicId?: number | null; sequenceOrder?: number | null };
/** Parent candidates: top-level topics of exactly the same class level and subject code. */
export const parentOptions = <T extends TopicLike>(topics: T[], classLevel: string, subjectCode: string, excludeId?: number) =>
  topics.filter(t => t.id !== excludeId && !t.parentTopicId && norm(t.classLevel) === norm(classLevel) && norm(t.subjectCode) === norm(subjectCode));
/** Parents first, each followed by its children; depth 1 marks sub-topics. */
export function orderHierarchy<T extends TopicLike>(topics: T[]): Array<{ topic: T; depth: number }> {
  const by = (a: T, b: T) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0) || a.id - b.id;
  const ids = new Set(topics.map(t => t.id));
  const roots = topics.filter(t => !t.parentTopicId || !ids.has(t.parentTopicId)).sort(by);
  return roots.flatMap(r => [{ topic: r, depth: 0 }, ...topics.filter(c => c.parentTopicId === r.id).sort(by).map(c => ({ topic: c, depth: 1 }))]);
}
