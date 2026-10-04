type TopicLike = { title: string; sequenceOrder?: number | null; learningObjectives?: string[] | null; sourceKind?: string | null };
type VersionLike = { id?: number; title: string; sourceOrganization?: string | null; sourceVersion?: string | null } | null | undefined;

/** Deterministic preview built only from actual published source topics. Never invents content. */
export function buildSyllabusOverview(topics: TopicLike[], version: VersionLike, versionId?: number): string {
  const official = topics.filter(t => t.sourceKind !== 'SCHOOL_SPECIFIC').sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0));
  if (!official.length) return '';
  const body = official.map((t, i) => {
    const objectives = (t.learningObjectives ?? []).filter(Boolean);
    return `${i + 1}. ${t.title}${objectives.length ? `\n   Objectives: ${objectives.join('; ')}` : ''}`;
  }).join('\n');
  const src = version
    ? `${version.title}${version.sourceOrganization ? `, ${version.sourceOrganization}` : ''}${version.sourceVersion ? ` ${version.sourceVersion}` : ''}`
    : `curriculum version #${versionId ?? 'unknown'}`;
  return `${body}\n\nSource: ${src}${version?.id ?? versionId ? ` (version #${version?.id ?? versionId})` : ''}. Reviewed and saved by the school.`;
}
