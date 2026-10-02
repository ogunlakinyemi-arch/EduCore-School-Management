import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookMarked, Copy, Download, FileUp, Archive, Plus, Pencil, Send } from 'lucide-react';
import {
  useListCurriculumVersions, useGetCurriculumVersion, useCreateCurriculumVersion, useUpdateCurriculumVersion,
  useAddCurriculumTopic, useUpdateCurriculumTopic, usePublishCurriculumVersion, useArchiveCurriculumVersion, useCloneCurriculumVersion,
  usePreviewCurriculumImport, useConfirmCurriculumImport, downloadCurriculumSourceDocument,
  getListCurriculumVersionsQueryKey, getGetCurriculumVersionQueryKey,
  type CurriculumVersion, type CurriculumTopic, type CurriculumVersionInput, type CurriculumImportPreview,
} from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, Field, Info, cx, date } from '@/components/shared';
import { Notice, errMsg, FRESH, useSchoolRole } from '@/components/school-ops-kit';
import { CANONICAL_IMPORT_FIELDS, cleanMapping, joinLines, label, orderHierarchy, parentOptions, splitCsv, splitLines } from '@/lib/curriculum-kit';
import { SourceDownload } from '@/components/source-download';

const LEVELS = ['PRIMARY', 'JSS', 'SSS', 'OTHER'] as const;
const KINDS = ['OFFICIAL', 'SCHOOL_SPECIFIC', 'EDUCORE_SEQUENCE', 'AI_ASSISTANCE'] as const;

function blankVersion(v?: CurriculumVersion | null): CurriculumVersionInput {
  return {
    title: v?.title ?? '', educationLevel: (v?.educationLevel as CurriculumVersionInput['educationLevel']) ?? 'JSS',
    classLevels: v?.classLevels ?? [], subjectCodes: v?.subjectCodes ?? [],
    sourceKind: (v?.sourceKind as CurriculumVersionInput['sourceKind']) ?? 'OFFICIAL',
    sourceOrganization: v?.sourceOrganization ?? '', sourceReference: v?.sourceReference ?? '', sourceVersion: v?.sourceVersion ?? '',
    effectiveDate: v?.effectiveDate?.slice(0, 10) ?? '', verifiedDate: v?.verifiedDate?.slice(0, 10) ?? '',
    description: v?.description ?? '', derivedFromVersionId: v?.derivedFromVersionId ?? null,
  };
}
const toPayload = (f: CurriculumVersionInput): CurriculumVersionInput => ({
  ...f, sourceVersion: f.sourceVersion?.trim() || null, effectiveDate: f.effectiveDate || null,
  verifiedDate: f.verifiedDate || null, description: f.description?.trim() || null,
});

function VersionFields({ form, setForm }: { form: CurriculumVersionInput; setForm: (f: CurriculumVersionInput) => void }) {
  const set = <K extends keyof CurriculumVersionInput>(k: K, v: CurriculumVersionInput[K]) => setForm({ ...form, [k]: v });
  return (
    <div className="space-y-4">
      <Field label="Title"><input required maxLength={250} className="w-full" value={form.title} onChange={e => set('title', e.target.value)} data-testid="input-version-title" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Education level"><select className="w-full" value={form.educationLevel} onChange={e => set('educationLevel', e.target.value as CurriculumVersionInput['educationLevel'])} data-testid="select-version-level">{LEVELS.map(l => <option key={l} value={l}>{label(l)}</option>)}</select></Field>
        <Field label="Source kind"><select className="w-full" value={form.sourceKind} onChange={e => set('sourceKind', e.target.value as CurriculumVersionInput['sourceKind'])} data-testid="select-version-kind">{KINDS.map(l => <option key={l} value={l}>{label(l)}</option>)}</select></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class levels (comma separated)"><input className="w-full" placeholder="JSS1, JSS2" value={(form.classLevels ?? []).join(', ')} onChange={e => set('classLevels', splitCsv(e.target.value))} data-testid="input-version-levels" /></Field>
        <Field label="Subject codes (comma separated)"><input className="w-full" placeholder="MTH, ENG" value={(form.subjectCodes ?? []).join(', ')} onChange={e => set('subjectCodes', splitCsv(e.target.value))} data-testid="input-version-subjects" /></Field>
      </div>
      <Field label="Source organization"><input required maxLength={250} className="w-full" value={form.sourceOrganization} onChange={e => set('sourceOrganization', e.target.value)} data-testid="input-version-org" /></Field>
      <Field label="Source reference (document title, URL or citation)"><textarea required maxLength={2000} className="w-full min-h-[64px]" value={form.sourceReference} onChange={e => set('sourceReference', e.target.value)} data-testid="input-version-reference" /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Source version"><input className="w-full" maxLength={150} value={form.sourceVersion ?? ''} onChange={e => set('sourceVersion', e.target.value)} /></Field>
        <Field label="Effective date"><input type="date" className="w-full" value={form.effectiveDate ?? ''} onChange={e => set('effectiveDate', e.target.value)} /></Field>
        <Field label="Verified date"><input type="date" className="w-full" value={form.verifiedDate ?? ''} onChange={e => set('verifiedDate', e.target.value)} data-testid="input-version-verified" /></Field>
      </div>
      <Field label="Description"><textarea maxLength={10000} className="w-full min-h-[64px]" value={form.description ?? ''} onChange={e => set('description', e.target.value)} /></Field>
    </div>
  );
}

function VersionDialog({ initial, onClose, onSaved }: { initial: CurriculumVersion | null; onClose: () => void; onSaved: (v: CurriculumVersion) => void }) {
  const [form, setForm] = useState(() => blankVersion(initial));
  const create = useCreateCurriculumVersion();
  const update = useUpdateCurriculumVersion();
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = toPayload(form);
    if (initial) update.mutate({ versionId: initial.id, data }, { onSuccess: onSaved });
    else create.mutate({ data }, { onSuccess: onSaved });
  };
  return (
    <Modal title={initial ? 'Edit draft version' : 'New curriculum version'} eyebrow="Provenance record" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" data-testid="form-version">
        <VersionFields form={form} setForm={setForm} />
        {error && <Notice tone="error">{errMsg(error)}</Notice>}
        <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={pending} testId="button-save-version">{pending ? 'Saving' : 'Save draft'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function TopicDialog({ versionId, defaults, topics = [], parentId = 0, existingTopic, onClose, onSaved }: { versionId: number; defaults: { classLevel: string; subjectCode: string }; topics?: CurriculumTopic[]; parentId?: number; existingTopic?: CurriculumTopic; onClose: () => void; onSaved: () => void }) {
  const add = useAddCurriculumTopic();
  const upd = useUpdateCurriculumTopic();
  const ex = existingTopic;
  const [f, setF] = useState(ex
    ? { classLevel: ex.classLevel, subjectCode: ex.subjectCode, title: ex.title, objectives: joinLines(ex.learningObjectives), outcomes: joinLines(ex.learningOutcomes), resources: joinLines(ex.suggestedResources), order: String(ex.sequenceOrder ?? 0) }
    : { ...defaults, title: '', objectives: '', outcomes: '', resources: '', order: '0' });
  const [parent, setParent] = useState(ex ? ex.parentTopicId ?? 0 : parentId);
  const hasChildren = !!ex && topics.some(t => t.parentTopicId === ex.id);
  const parents = hasChildren ? [] : parentOptions(topics, f.classLevel, f.subjectCode, ex?.id);
  const parentValue = parents.some(p => p.id === parent) ? parent : 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = { classLevel: f.classLevel.trim(), subjectCode: f.subjectCode.trim(), title: f.title.trim(), learningObjectives: splitLines(f.objectives), learningOutcomes: splitLines(f.outcomes), suggestedResources: splitLines(f.resources), sequenceOrder: Number(f.order) || 0, parentTopicId: parentValue || null };
    if (ex) upd.mutate({ versionId, topicId: ex.id, data }, { onSuccess: onSaved });
    else add.mutate({ versionId, data }, { onSuccess: onSaved });
  };
  return (
    <Modal title={ex ? "Edit topic" : "Add topic"} eyebrow="Draft version" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" data-testid="form-topic">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Class level"><input required className="w-full" value={f.classLevel} onChange={e => setF({ ...f, classLevel: e.target.value })} data-testid="input-topic-level" /></Field>
          <Field label="Subject code"><input required className="w-full" value={f.subjectCode} onChange={e => setF({ ...f, subjectCode: e.target.value })} data-testid="input-topic-subject" /></Field>
        </div>
        <Field label="Parent topic (leave empty for a main topic)"><select className="w-full" disabled={hasChildren} value={parentValue} onChange={e => setParent(Number(e.target.value))} data-testid="select-topic-parent"><option value={0}>No parent (main topic)</option>{parents.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
        <Field label="Topic title"><input required maxLength={250} className="w-full" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} data-testid="input-topic-title" /></Field>
        <Field label="Learning objectives (one per line)"><textarea className="w-full min-h-[70px]" value={f.objectives} onChange={e => setF({ ...f, objectives: e.target.value })} /></Field>
        <Field label="Learning outcomes (one per line)"><textarea className="w-full min-h-[70px]" value={f.outcomes} onChange={e => setF({ ...f, outcomes: e.target.value })} /></Field>
        <Field label="Suggested resources (one per line)"><textarea className="w-full min-h-[70px]" value={f.resources} onChange={e => setF({ ...f, resources: e.target.value })} /></Field>
        <Field label="Sequence order"><input type="number" min={0} className="w-full" value={f.order} onChange={e => setF({ ...f, order: e.target.value })} /></Field>
        {(add.error ?? upd.error) && <Notice tone="error">{errMsg(add.error ?? upd.error)}</Notice>}
        <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={add.isPending || upd.isPending} testId="button-save-topic">{add.isPending || upd.isPending ? 'Saving' : ex ? 'Save topic' : 'Add topic'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function VersionDetail({ versionId, onSelect, onEdit }: { versionId: number; onSelect: (id: number) => void; onEdit: (v: CurriculumVersion) => void }) {
  const qc = useQueryClient();
  const q = useGetCurriculumVersion(versionId, { query: { queryKey: getGetCurriculumVersionQueryKey(versionId), ...FRESH } });
  const publish = usePublishCurriculumVersion();
  const archive = useArchiveCurriculumVersion();
  const clone = useCloneCurriculumVersion();
  const [topicOpen, setTopicOpen] = useState(false);
  const [subOf, setSubOf] = useState<CurriculumTopic | null>(null);
  const [editTopic, setEditTopic] = useState<CurriculumTopic | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'archive' | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: getListCurriculumVersionsQueryKey() }); qc.invalidateQueries({ queryKey: getGetCurriculumVersionQueryKey(versionId) }); };
  if (q.isLoading) return <div className="h-64 animate-pulse rounded-2xl bg-[hsl(var(--muted))]" />;
  if (q.isError || !q.data) return <ErrorState retry={() => q.refetch()} message={errMsg(q.error, 'This version could not be loaded.')} />;
  const v = q.data;
  const topics = [...(v.topics ?? [])].sort((a, b) => a.classLevel.localeCompare(b.classLevel) || (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0));
  const draft = v.status === 'DRAFT';
  const err = publish.error ?? archive.error ?? clone.error;
  return (
    <section className="panel p-6 md:p-8" data-testid="panel-version-detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">{label(v.sourceKind)} source</div>
          <h2 className="display-font mt-1 text-2xl font-bold" data-testid="text-version-title">{v.title}</h2>
          <div className="mt-2 flex items-center gap-2"><StatusPill value={v.status} /><span className="text-xs text-[hsl(var(--muted-foreground))]">{label(v.educationLevel)}</span></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft && <Button variant="outline" onClick={() => onEdit(v)} testId="button-edit-version"><Pencil size={14} />Edit</Button>}
          {draft && <Button variant="outline" onClick={() => setTopicOpen(true)} testId="button-add-topic"><Plus size={14} />Topic</Button>}
          {draft && <Button onClick={() => setConfirm('publish')} testId="button-publish-version"><Send size={14} />Publish</Button>}
          {v.status === 'PUBLISHED' && <Button variant="danger" onClick={() => setConfirm('archive')} testId="button-archive-version"><Archive size={14} />Archive</Button>}
          <Button variant="outline" disabled={clone.isPending} onClick={() => clone.mutate({ versionId }, { onSuccess: c => { refresh(); onSelect(c.id); } })} testId="button-clone-version"><Copy size={14} />Clone as draft</Button>
        </div>
      </div>
      {err && <div className="mt-4"><Notice tone="error">{errMsg(err)}</Notice></div>}
      {confirm && (
        <div className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.4)] p-4" role="alertdialog" data-testid="confirm-version-action">
          <p className="text-sm font-medium">{confirm === 'publish' ? 'Publishing makes this version available for schools to adopt. Published content is no longer editable; clone it to revise.' : 'Archiving stops new school adoption. Existing school mappings keep their reference.'}</p>
          <div className="mt-3 flex gap-2">
            <Button disabled={publish.isPending || archive.isPending} testId="button-confirm-version-action" onClick={() => (confirm === 'publish' ? publish : archive).mutate({ versionId }, { onSuccess: () => { setConfirm(null); refresh(); } })}>Confirm {confirm}</Button>
            <Button variant="quiet" onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Info label="Source organization" value={v.sourceOrganization} />
        <Info label="Source version" value={v.sourceVersion} />
        <Info label="Effective" value={date(v.effectiveDate)} />
        <Info label="Verified" value={date(v.verifiedDate)} />
        <Info label="Class levels" value={v.classLevels.join(', ')} />
        <Info label="Subject codes" value={v.subjectCodes.join(', ')} />
        <Info label="Derived from" value={v.derivedFromVersionId ? `Version #${v.derivedFromVersionId}` : null} />
        <Info label="Published" value={date(v.publishedAt)} />
        <Info label="Source document" value={v.sourceDocumentPath ? 'Stored privately' : 'None'} />
      </div>
      {v.sourceImportId ? <div className="mt-4"><SourceDownload importId={v.sourceImportId} filename={`${v.title}-source`} testId="button-download-version-source" /></div> : null}
      <p className="mt-4 whitespace-pre-wrap text-sm text-[hsl(var(--muted-foreground))]"><span className="font-bold text-[hsl(var(--foreground))]">Reference: </span>{v.sourceReference}</p>
      {v.description && <p className="mt-2 whitespace-pre-wrap text-sm text-[hsl(var(--muted-foreground))]">{v.description}</p>}
      <h3 className="display-font mt-8 text-lg font-bold">Topics ({topics.length})</h3>
      {topics.length === 0 ? <EmptyState icon={BookMarked} title="No topics yet" description={draft ? 'Add topics manually or import them from a reviewed official document.' : 'This version has no topics.'} /> : (
        <ol className="mt-3 divide-y divide-[hsl(var(--border)/.6)]" data-testid="list-topics">
          {orderHierarchy(topics).map(({ topic: t, depth }) => (
            <li key={t.id} className={cx('py-3', depth > 0 && 'ml-6 border-l-2 border-[hsl(var(--border))] pl-4')} data-testid={`row-topic-${t.id}`}>
              <div className="flex flex-wrap items-center gap-2"><span className="font-bold">{t.title}</span>{depth > 0 && <span className="rounded bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" data-testid={`badge-subtopic-${t.id}`}>Sub-topic</span>}{draft && <button type="button" className="text-xs font-bold underline" onClick={() => setEditTopic(t)} data-testid={`button-edit-topic-${t.id}`}>Edit</button>}{draft && depth === 0 && <button type="button" className="text-xs font-bold underline" onClick={() => setSubOf(t)} data-testid={`button-add-subtopic-${t.id}`}>Add sub-topic</button>}<span className="rounded bg-[hsl(var(--primary)/.1)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--primary))]">{t.classLevel}</span><span className="text-[11px] text-[hsl(var(--muted-foreground))]">Subject code {t.subjectCode} / {label(t.sourceKind)}</span></div>
              {!!t.learningObjectives?.length && <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Objectives: {t.learningObjectives.join('; ')}</p>}
              {!!t.learningOutcomes?.length && <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Outcomes: {t.learningOutcomes.join('; ')}</p>}
            </li>
          ))}
        </ol>
      )}
      {draft && editTopic && <TopicDialog key={editTopic.id} versionId={versionId} topics={topics} existingTopic={editTopic} defaults={{ classLevel: editTopic.classLevel, subjectCode: editTopic.subjectCode }} onClose={() => setEditTopic(null)} onSaved={() => { setEditTopic(null); refresh(); }} />}
      {subOf && <TopicDialog versionId={versionId} topics={topics} parentId={subOf.id} defaults={{ classLevel: subOf.classLevel, subjectCode: subOf.subjectCode }} onClose={() => setSubOf(null)} onSaved={() => { setSubOf(null); refresh(); }} />}
      {topicOpen && <TopicDialog versionId={versionId} topics={topics} defaults={{ classLevel: v.classLevels[0] ?? '', subjectCode: v.subjectCodes[0] ?? '' }} onClose={() => setTopicOpen(false)} onSaved={() => { setTopicOpen(false); refresh(); }} />}
    </section>
  );
}

function ImportWizard({ onDone }: { onDone: (id: number) => void }) {
  const qc = useQueryClient();
  const preview = usePreviewCurriculumImport();
  const confirm = useConfirmCurriculumImport();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CurriculumImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [correctedRows, setCorrectedRows] = useState<Array<Record<string, string>> | null>(null);
  const [form, setForm] = useState<CurriculumVersionInput>(() => ({ ...blankVersion(), sourceKind: 'OFFICIAL' }));
  const [reviewed, setReviewed] = useState(false);
  const [dlError, setDlError] = useState('');
  const upload = () => file && preview.mutate({ data: { file } }, { onSuccess: r => { setResult(r); setMapping({ ...r.mapping }); setCorrectedRows(null); setReviewed(false); } });
  const mappedRows = (result?.rows ?? []).map(row => Object.fromEntries(
    ['classLevel', 'subjectCode', 'title', 'learningObjectives', 'learningOutcomes', 'suggestedResources']
      .map(field => [field, row[mapping[field] ?? ''] ?? '']),
  ));
  const download = async () => {
    if (!result) return;
    setDlError('');
    try {
      const blob = await downloadCurriculumSourceDocument(result.importId, { responseType: 'blob' });
      if (!(blob instanceof Blob)) throw new Error('The server did not return a file.');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file?.name ?? `curriculum-source-${result.importId}`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setDlError(errMsg(e, 'The source document could not be downloaded.')); }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!result) return;
    confirm.mutate({ importId: result.importId, data: ({
      version: toPayload(form), mapping: cleanMapping(mapping), reviewerConfirmed: true,
      ...(correctedRows ? { correctedRows } : {}),
    } as unknown as Parameters<typeof confirm.mutate>[0]['data']) }, {
      onSuccess: v => { qc.invalidateQueries({ queryKey: getListCurriculumVersionsQueryKey() }); onDone(v.id); },
    });
  };
  const missing = ['title', 'classLevel', 'subjectCode'].filter(k => !mapping[k]);
  return (
    <section className="panel p-6 md:p-8" data-testid="panel-import">
      <div className="eyebrow">Reviewed document import</div>
      <h2 className="display-font mt-1 text-2xl font-bold">Import from an official document</h2>
      <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">Upload a CSV, XLSX or readable PDF. The file is stored privately. Nothing becomes a curriculum version until you review the extraction, map the columns and confirm. Content that cannot be extracted is never invented; add it manually to the draft afterwards.</p>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <Field label="Document (CSV, XLSX or PDF)"><input type="file" accept=".csv,.xlsx,.pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="input-import-file" /></Field>
        <Button onClick={upload} disabled={!file || preview.isPending} testId="button-preview-import"><FileUp size={15} />{preview.isPending ? 'Reading' : 'Preview extraction'}</Button>
      </div>
      {preview.error && <div className="mt-4"><Notice tone="error">{errMsg(preview.error)}</Notice></div>}
      {result && (
        <form onSubmit={submit} className="mt-8 space-y-6" data-testid="form-import-confirm">
          <div className="flex flex-wrap items-center gap-3 text-sm"><StatusPill value={result.detectedType} /><span>{result.rows.length} extracted rows</span><Button variant="outline" onClick={download} testId="button-download-source"><Download size={14} />Download source</Button></div>
          {dlError && <Notice tone="error">{dlError}</Notice>}
          {result.warnings.length > 0 && <Notice tone="info"><ul className="list-disc pl-4" data-testid="list-import-warnings">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Notice>}
          {result.rows.length === 0 && <Notice tone="error">No rows could be read from this document. Cancel and use a CSV or XLSX, or build the version manually.</Notice>}
          <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border))]">
            <table className="w-full text-left text-xs" data-testid="table-import-preview">
              <thead className="bg-[hsl(var(--muted)/.5)]"><tr>{result.headers.map(h => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
              <tbody>{result.rows.slice(0, 25).map((r, i) => <tr key={i} className="border-t border-[hsl(var(--border)/.6)]">{result.headers.map(h => <td key={h} className="max-w-[260px] truncate px-3 py-2">{r[h]}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {result.rows.length > 25 && <p className="text-xs text-[hsl(var(--muted-foreground))]">The preview table shows the first 25 source rows. All {result.rows.length} extracted rows are available for review and correction below.</p>}
          <div>
            <h3 className="display-font text-lg font-bold">Column mapping</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CANONICAL_IMPORT_FIELDS.map(f => (
                <Field key={f} label={`${label(f.replace(/([A-Z])/g, '_$1'))}${['title', 'classLevel', 'subjectCode'].includes(f) ? ' (required)' : ''}`}>
                   <select className="w-full" value={mapping[f] ?? ''} onChange={e => { setMapping({ ...mapping, [f]: e.target.value }); setCorrectedRows(null); setReviewed(false); }} data-testid={`select-map-${f}`}>
                    <option value="">Not in document</option>
                    {result.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </div>
          {result.rows.length > 0 && (
            <div>
              <h3 className="display-font mb-1 text-lg font-bold">Review and correct extracted topics</h3>
              <p className="mb-3 text-xs text-[hsl(var(--muted-foreground))]">Edit any mapped value before creating the draft. If you edit a row, all reviewed rows are sent to the server.</p>
              <div className="max-h-[420px] overflow-auto rounded-xl border border-[hsl(var(--border))]">
                <table className="w-full text-left text-xs" data-testid="table-corrected-import-rows">
                  <thead className="sticky top-0 bg-[hsl(var(--muted))]"><tr>{['classLevel', 'subjectCode', 'title', 'learningObjectives', 'learningOutcomes', 'suggestedResources'].map(field => <th key={field} className="min-w-[150px] px-2 py-2">{label(field.replace(/([A-Z])/g, '_$1'))}</th>)}</tr></thead>
                  <tbody>{mappedRows.map((row, index) => (
                    <tr key={index} className="border-t border-[hsl(var(--border)/.6)]">
                      {['classLevel', 'subjectCode', 'title', 'learningObjectives', 'learningOutcomes', 'suggestedResources'].map(field => (
                        <td key={field} className="p-1">
                          <input
                            aria-label={`Row ${index + 1} ${label(field)}`}
                            className="w-full min-w-[140px] rounded border border-[hsl(var(--border))] bg-background px-2 py-1"
                            value={correctedRows?.[index]?.[field] ?? row[field] ?? ''}
                            onChange={event => {
                              const next = correctedRows ?? mappedRows.map(value => ({ ...value }));
                              next[index] = { ...next[index], [field]: event.target.value };
                              setCorrectedRows(next);
                              setReviewed(false);
                            }}
                            maxLength={2000}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
          <div>
            <h3 className="display-font mb-3 text-lg font-bold">Version provenance</h3>
            <VersionFields form={form} setForm={setForm} />
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} data-testid="check-import-reviewed" /><span>I reviewed the extracted rows and mapping against the source document.</span></label>
          {missing.length > 0 && <Notice tone="error">Map the required columns: {missing.join(', ')}.</Notice>}
          {confirm.error && <Notice tone="error">{errMsg(confirm.error)}</Notice>}
          <div className="flex justify-end"><Button type="submit" disabled={!reviewed || missing.length > 0 || confirm.isPending} testId="button-confirm-import">{confirm.isPending ? 'Creating draft' : 'Create draft version'}</Button></div>
        </form>
      )}
    </section>
  );
}

export function CurriculumManagementPage() {
  const role = useSchoolRole();
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState<'library' | 'import'>('library');
  const [selected, setSelected] = useState(0);
  const [dialog, setDialog] = useState<{ edit: CurriculumVersion | null } | null>(null);
  const qc = useQueryClient();
  const params = status ? { status: status as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' } : undefined;
  const q = useListCurriculumVersions(params, { query: { enabled: role.isPlatformOwner, queryKey: getListCurriculumVersionsQueryKey(params), ...FRESH } });
  if (role.loading) return <SkeletonPage />;
  if (!role.isPlatformOwner) return <EmptyState icon={BookMarked} title="Platform Owner only" description="The central curriculum library is managed by the Platform Owner. School Admins assign it from Curriculum." />;
  const versions = q.data ?? [];
  const done = (id: number) => { qc.invalidateQueries({ queryKey: getListCurriculumVersionsQueryKey() }); qc.invalidateQueries({ queryKey: getGetCurriculumVersionQueryKey(id) }); setSelected(id); setTab('library'); };
  return (
    <div className="fade-up">
      <PageHeading eyebrow="Central library" title="Curriculum management." description="One versioned, provenance-controlled library shared by every school. Official sources are recorded and verified, never retyped per school." action={<Button onClick={() => setDialog({ edit: null })} testId="button-new-version"><Plus size={16} />New version</Button>} />
      <div className="mb-6 flex gap-2 border-b border-[hsl(var(--border))]" role="tablist">
        {([['library', 'Library'], ['import', 'Document import']] as const).map(([id, l]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`tab-${id}`} className={cx('border-b-2 px-4 py-2.5 text-sm font-bold transition-colors', tab === id ? 'border-[hsl(var(--primary))]' : 'border-transparent text-[hsl(var(--muted-foreground))]')}>{l}</button>
        ))}
      </div>
      {tab === 'import' ? <ImportWizard onDone={done} /> : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <aside className="panel h-fit overflow-hidden">
            <div className="border-b border-[hsl(var(--border))] p-4">
              <select className="w-full" value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status" data-testid="select-status-filter">
                <option value="">All statuses</option><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option>
              </select>
            </div>
            {q.isLoading ? <div className="h-40 animate-pulse bg-[hsl(var(--muted))]" /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} /> : versions.length === 0 ? (
              <EmptyState icon={BookMarked} title="No versions" description="Create a version or import an official document." />
            ) : (
              <ul className="divide-y divide-[hsl(var(--border)/.6)]" data-testid="list-versions">
                {versions.map(v => (
                  <li key={v.id}><button onClick={() => setSelected(v.id)} data-testid={`button-version-${v.id}`} className={cx('w-full p-4 text-left hover:bg-[hsl(var(--muted)/.4)]', selected === v.id && 'bg-[hsl(var(--primary)/.06)]')}>
                    <div className="font-bold">{v.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><StatusPill value={v.status} />{label(v.sourceKind)} / {v.sourceOrganization}</div>
                  </button></li>
                ))}
              </ul>
            )}
          </aside>
          {selected ? <VersionDetail key={selected} versionId={selected} onSelect={setSelected} onEdit={v => setDialog({ edit: v })} /> : <div className="panel"><EmptyState icon={BookMarked} title="Select a version" description="Open a version to see provenance, topics and publication controls." /></div>}
        </div>
      )}
      {dialog && <VersionDialog initial={dialog.edit} onClose={() => setDialog(null)} onSaved={v => { setDialog(null); done(v.id); }} />}
    </div>
  );
}

export default CurriculumManagementPage;
