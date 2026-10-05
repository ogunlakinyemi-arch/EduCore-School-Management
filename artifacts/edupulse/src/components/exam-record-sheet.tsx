import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Button, StatusPill, Modal, ErrorState, SkeletonPage } from '@/components/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { examApi, errMsg, fileToBase64, saveBlob, statusLabel, type Scope, type Component, type GradingRule, type ImportPreview, type Sheet } from '@/lib/exam-record-api';
import { ArrowLeft, Download, Save, Send, Upload } from 'lucide-react';

const NUM = /^\d+(\.\d+)?$/;
const LOCKED = ['SUBMITTED', 'RESUBMITTED', 'PUBLISHED', 'LOCKED', 'APPROVED'];
export const isEditableStatus = (s: string | null | undefined) => !LOCKED.includes((s ?? '').toUpperCase());

export type Cells = Record<number, Record<string, string>>;
export function cellError(v: string, maxScore: number | null) {
  if (v === '') return '';
  if (!NUM.test(v.trim())) return 'Numbers only';
  if (maxScore !== null && Number(v) > maxScore) return `Max ${maxScore}`;
  return '';
}
/** Parses clipboard text (tab/newline) into a grid; returns null for single-cell text. */
export function parseClipboardGrid(text: string): string[][] | null {
  const t = text.replace(/\r/g, '').replace(/\n$/, '');
  if (!/[\t\n]/.test(t)) return null;
  return t.split('\n').map(l => l.split('\t'));
}
/** Applies a rectangular paste starting at (r,c); overflow rows/columns are dropped. */
export function applyPasteGrid(prev: Cells, rows: { studentId: number }[], comps: { key: string }[], r: number, c: number, grid: string[][]): Cells {
  const next = { ...prev };
  grid.forEach((line, i) => { const row = rows[r + i]; if (!row) return; next[row.studentId] = { ...next[row.studentId] }; line.forEach((v, j) => { const comp = comps[c + j]; if (comp) next[row.studentId][comp.key] = v.trim(); }); });
  return next;
}

export function nextComponentKey(comps: { key: string }[]) {
  let n = comps.length + 1; const keys = new Set(comps.map(c => c.key));
  while (keys.has(`new-${n}`)) n++;
  return `new-${n}`;
}
export function retainComponentCells(cells: Record<number, Record<string, string>>, comps: { key: string }[]) {
  const keys = new Set(comps.map(c => c.key));
  return Object.fromEntries(Object.entries(cells).map(([studentId, values]) => [
    studentId, Object.fromEntries(Object.entries(values).filter(([key]) => keys.has(key))),
  ]));
}

/** Inline component configuration. Persisted components (assessmentId set) are locked; unsaved ones can be edited or removed. */
export function ComponentsPanel({ comps, types, typesLoading, onChange }: { comps: Component[]; types: { id: number; name: string; maxScore: number | null }[]; typesLoading?: boolean; onChange: (next: Component[]) => void }) {
  const [maxText, setMaxText] = useState<Record<string, string>>({});
  const usedKeys = useRef(new Set(comps.map(c => c.key)));
  comps.forEach(c => usedKeys.current.add(c.key));
  const patch = (key: string, p: Partial<Component>) => onChange(comps.map(c => c.key === key ? { ...c, ...p } : c));
  const add = () => {
    const key = nextComponentKey([...usedKeys.current].map(key => ({ key })));
    usedKeys.current.add(key);
    onChange([...comps, { key, label: '', typeId: types[0]?.id ?? null, maxScore: null, assessmentId: null }]);
  };
  return <section className="panel space-y-3 p-5" data-testid="panel-er-components" aria-label="Result components">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Components</h3><p className="text-xs text-[hsl(var(--muted-foreground))]">Name each column (for example CA1, CA2, Examination), choose an existing assessment type and set its maximum. Saved components are locked so scores and history are preserved.</p></div>
      <Button variant="outline" onClick={add} disabled={typesLoading || !types.length} testId="button-er-add-component">Add component</Button></div>
    {!typesLoading && !types.length && <p role="alert" className="text-xs font-bold text-[hsl(var(--destructive))]">No active assessment types exist for this school. Ask the School Admin to create one.</p>}
    <ul className="space-y-2">{comps.map((c, i) => { const locked = c.assessmentId != null; const tName = types.find(t => t.id === c.typeId)?.name ?? '-'; return <li key={c.key} className="grid items-end gap-2 md:grid-cols-[1fr_12rem_7rem_auto]" data-testid={`row-er-component-${i}`}>
      <label className="text-xs font-bold">Name<input aria-label={`Component name ${i + 1}`} data-testid={`input-er-component-name-${i}`} className="mt-1 w-full" value={c.label} disabled={locked} placeholder="CA1" onChange={e => patch(c.key, { label: e.target.value })} /></label>
      <label className="text-xs font-bold">Type{locked ? <div className="mt-1 py-2 font-medium">{tName}</div> : <select aria-label={`Component type ${i + 1}`} data-testid={`select-er-component-type-${i}`} className="mt-1 w-full" value={c.typeId ?? ''} onChange={e => patch(c.key, { typeId: Number(e.target.value) })}>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}</label>
      <label className="text-xs font-bold">Maximum<input aria-label={`Component maximum ${i + 1}`} data-testid={`input-er-component-max-${i}`} inputMode="decimal" className="mt-1 w-full" disabled={locked} value={locked ? (c.maxScore ?? '') : (maxText[c.key] ?? (c.maxScore ?? ''))} onChange={e => { const v = e.target.value.trim(); setMaxText(m => ({ ...m, [c.key]: v })); patch(c.key, { maxScore: v !== '' && NUM.test(v) ? Number(v) : null }); }} /></label>
      {locked ? <span className="pb-2 text-xs text-[hsl(var(--muted-foreground))]">Saved</span> : <Button variant="quiet" onClick={() => onChange(comps.filter(x => x.key !== c.key))} testId={`button-er-remove-component-${i}`}>Remove</Button>}
    </li>; })}</ul>
  </section>;
}

export function SheetBanners({ status, comment }: { status: string; comment: string | null }) {
  const st = (status || '').toUpperCase();
  return <>
    {comment && st === 'RETURNED' && <div role="status" className="rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)] p-4 text-sm"><strong>Returned - correction required.</strong> {comment}</div>}
    {!isEditableStatus(status) && <div role="status" className="rounded-xl bg-[hsl(var(--secondary))] p-4 text-sm">This result is {statusLabel(status).toLowerCase()} and is read-only.</div>}
  </>;
}
export function SheetActions({ editable, busy, dirty, onTemplate, onUpload, onSave, onSubmit }: { editable: boolean; busy: boolean; dirty: boolean; onTemplate: () => void; onUpload: () => void; onSave: () => void; onSubmit: () => void }) {
  if (!editable) return null;
  return <div className="flex flex-wrap gap-2">
    <Button variant="outline" onClick={onTemplate} testId="button-er-template"><Download size={15} />Result template</Button>
    <Button variant="outline" onClick={onUpload} testId="button-er-upload"><Upload size={15} />Upload Excel / PDF</Button>
    <Button variant="outline" onClick={onSave} disabled={busy || !dirty} testId="button-er-save"><Save size={15} />Save draft</Button>
    <Button onClick={onSubmit} disabled={busy} testId="button-er-submit"><Send size={15} />Submit result</Button>
  </div>;
}

export function gradeFor(total: number | null, maxSum: number | null, rules: GradingRule[]) {
  if (total === null || !maxSum || !rules.length) return '';
  const pct = (total / maxSum) * 100;
  return rules.find(r => pct >= r.minScore && pct <= r.maxScore)?.grade ?? '';
}

export function SheetEditor({ scope, title, onBack }: { scope: Scope; title: string; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['er-sheet', scope], queryFn: () => examApi.sheet(scope), staleTime: 0, gcTime: 0 });
  const typeQ = useQuery({ queryKey: ['er-types', scope.schoolId, scope.sessionId, scope.termId], queryFn: () => examApi.context({ schoolId: scope.schoolId, sessionId: scope.sessionId, termId: scope.termId }) });
  const [comps, setComps] = useState<Component[]>([]);
  const [cells, setCells] = useState<Record<number, Record<string, string>>>({});
  const [dirty, setDirty] = useState(false);
  const [meta, setMeta] = useState<{ batchId: number | null; revision: number; status: string; comment: string | null }>({ batchId: null, revision: 0, status: '', comment: null });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const fixedMax = useRef<Set<string>>(new Set());

  const load = (s: Sheet) => {
    fixedMax.current = new Set(s.components.filter(c => c.maxScore !== null).map(c => c.key));
    setComps(s.components);
    setCells(Object.fromEntries(s.rows.map(r => [r.studentId, Object.fromEntries(s.components.map(c => [c.key, r.scores?.[c.key] === null || r.scores?.[c.key] === undefined ? '' : String(r.scores[c.key])]))])));
    setMeta({ batchId: s.batchId, revision: s.revision, status: s.status, comment: s.returnComment });
    setDirty(false);
  };
  const loaded = useRef(false);
  useEffect(() => { if (q.data && !loaded.current) { loaded.current = true; load(q.data); } }, [q.data]);

  const rows = q.data?.rows ?? [];
  const rules = q.data?.gradingRules ?? [];
  const editable = isEditableStatus(meta.status);
  const maxSum = comps.length && comps.every(c => c.maxScore) ? comps.reduce((a, c) => a + (c.maxScore ?? 0), 0) : null;

  const cellErr = (sid: number, c: Component) => cellError(cells[sid]?.[c.key] ?? '', c.maxScore);
  const problems = useMemo(() => {
    let invalid = 0, empty = 0;
    for (const r of rows) for (const c of comps) { const v = cells[r.studentId]?.[c.key] ?? ''; if (v === '') empty++; else if (cellErr(r.studentId, c)) invalid++; }
    return { invalid, empty, noMax: comps.filter(c => !c.maxScore).length };
  }, [cells, comps, rows]);

  const setCell = (sid: number, key: string, v: string) => { setCells(p => ({ ...p, [sid]: { ...p[sid], [key]: v } })); setDirty(true); setMsg(null); };
  const focus = (r: number, c: number) => (document.querySelector(`[data-cell="${r}-${c}"]`) as HTMLInputElement | null)?.focus();
  const onKey = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key === 'Enter') { e.preventDefault(); focus(e.shiftKey ? r - 1 : r + 1, c); }
    if (e.key === 'ArrowDown') { e.preventDefault(); focus(r + 1, c); }
    if (e.key === 'ArrowUp') { e.preventDefault(); focus(r - 1, c); }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const grid = parseClipboardGrid(e.clipboardData.getData('text'));
    if (!grid) return;
    e.preventDefault();
    setCells(prev => applyPasteGrid(prev, rows, comps, r, c, grid));
    setDirty(true); setMsg(null);
  };

  const payload = () => ({
    scope, revision: meta.revision, components: comps,
    rows: rows.map(r => ({ ...r, scores: Object.fromEntries(comps.map(c => { const v = (cells[r.studentId]?.[c.key] ?? '').trim(); return [c.key, v === '' ? null : Number(v)]; })) })),
  });
  const compError = () => { const names = comps.map(c => c.label.trim().toLowerCase()); if (comps.some(c => !c.label.trim())) return 'Every component needs a name.'; if (new Set(names).size !== names.length) return 'Component names must be unique.'; if (comps.some(c => c.assessmentId == null && !c.typeId)) return 'Choose an assessment type for every new component.'; if (comps.some(c => c.maxScore == null || !(c.maxScore > 0))) return 'Component maximum must be above zero.'; return ''; };
  const save = async (): Promise<Sheet | null> => {
    const ce = compError(); if (ce) { setMsg({ ok: false, text: ce }); return null; }
    if (problems.invalid) { setMsg({ ok: false, text: 'Fix the highlighted scores before saving.' }); return null; }
    setBusy(true);
    try { const s = await examApi.saveDraft(payload()); setMeta({ batchId: s.batchId, revision: s.revision, status: s.status, comment: s.returnComment }); setDirty(false); setMsg({ ok: true, text: 'Draft saved.' }); qc.invalidateQueries({ queryKey: ['er-context'] }); return s; }
    catch (e) { setMsg({ ok: false, text: errMsg(e) }); return null; } finally { setBusy(false); }
  };
  const submit = async () => {
    const ce = compError(); if (ce) { setMsg({ ok: false, text: ce }); return; }
    if (problems.invalid || problems.empty || problems.noMax) { setMsg({ ok: false, text: 'Complete every score and maximum with valid numbers before submitting.' }); return; }
    if (!confirm('Submit this subject result? You will not be able to edit it unless it is returned.')) return;
    let batchId = meta.batchId, revision = meta.revision;
    if (dirty || !batchId) { const s = await save(); if (!s) return; batchId = s.batchId; revision = s.revision; }
    if (!batchId) { setMsg({ ok: false, text: 'No saved draft to submit.' }); return; }
    setBusy(true);
    try { const r = await examApi.submit({ schoolId: scope.schoolId, batchId, revision }); setMeta(m => ({ ...m, status: r.status, revision: r.revision })); setMsg({ ok: true, text: 'Result submitted to School Admin.' }); qc.invalidateQueries({ queryKey: ['er-context'] }); }
    catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  };
  const template = async () => {
    try {
      if (dirty) { const saved = await save(); if (!saved) return; } // server template is built from saved components
      saveBlob(await examApi.template(scope), `result-template-${title.replace(/\W+/g, '-')}.xlsx`);
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  };

  if (q.isLoading) return <SkeletonPage />;
  if (q.isError) return <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={() => { if (dirty && !confirm('Discard unsaved changes?')) return; onBack(); }}><ArrowLeft size={15} />My results</Button>
        <div className="min-w-0 flex-1"><h2 className="display-font text-xl font-bold">{title}</h2><div className="mt-1"><StatusPill value={statusLabel(meta.status || 'DRAFT')} /> {dirty && <span className="ml-2 text-xs font-bold text-[hsl(var(--primary))]">Unsaved changes</span>}</div></div>
        <SheetActions editable={editable} busy={busy} dirty={dirty} onTemplate={template} onUpload={() => setImporting(true)} onSave={save} onSubmit={submit} />
      </div>
      <SheetBanners status={meta.status} comment={meta.comment} />
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm font-bold text-[hsl(157_37%_30%)]' : 'text-sm font-bold text-[hsl(var(--destructive))]'}>{msg.text}</p>}
      {editable && <ComponentsPanel comps={comps} types={typeQ.data?.assessmentTypes ?? []} typesLoading={typeQ.isLoading} onChange={next => { setComps(next); setCells(previous => retainComponentCells(previous, next)); setDirty(true); setMsg(null); }} />}
      <div className="panel overflow-x-auto">
        {rows.length === 0 ? <p className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">No students are enrolled in this class and section for the selected term.</p> :
        <table className="w-full min-w-[640px] text-sm" data-testid="table-er-sheet">
          <thead className="bg-[hsl(var(--muted)/.4)] text-left text-xs uppercase tracking-wider">
            <tr><th className="p-3">Student</th>{comps.map(c => <th key={c.key} className="p-3">
              <div>{c.label}</div>
              <div className="font-medium normal-case text-[hsl(var(--muted-foreground))]">out of {c.maxScore ?? '-'}</div>
            </th>)}<th className="p-3">Total</th><th className="p-3">Grade</th></tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border)/.6)]">
            {rows.map((r, ri) => {
              const vals = comps.map(c => cells[r.studentId]?.[c.key] ?? '');
              const total = vals.every(v => v === '') ? null : vals.reduce((a, v) => a + (NUM.test(v.trim()) ? Number(v) : 0), 0);
              return <tr key={r.studentId}>
                <td className="p-3"><div className="font-bold">{r.studentName}</div><div className="text-[11px] text-[hsl(var(--muted-foreground))]">{r.admissionNo}</div></td>
                {comps.map((c, ci) => { const err = cellErr(r.studentId, c); return <td key={c.key} className="p-2">
                  <input data-cell={`${ri}-${ci}`} inputMode="decimal" autoComplete="off" disabled={!editable} aria-label={`${r.studentName} ${c.label}`} aria-invalid={!!err} title={err || undefined}
                    className={'h-9 w-20 text-center ' + (err ? 'border-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/.08)]' : '')}
                    value={cells[r.studentId]?.[c.key] ?? ''} onChange={e => setCell(r.studentId, c.key, e.target.value)} onKeyDown={e => onKey(e, ri, ci)} onPaste={e => onPaste(e, ri, ci)} />
                  {err && <div className="text-[10px] font-bold text-[hsl(var(--destructive))]">{err}</div>}
                </td>; })}
                <td className="p-3 font-bold tabular-nums">{total === null ? 'Auto' : total}</td>
                <td className="p-3 font-bold">{gradeFor(total, maxSum, rules) || 'Auto'}</td>
              </tr>;
            })}
          </tbody>
        </table>}
      </div>
      {editable && rows.length > 0 && <p className="text-xs text-[hsl(var(--muted-foreground))]">Tab moves across, Enter moves down. Paste a block of cells from Excel into any cell. {problems.empty} blank, {problems.invalid} invalid. Total and grade are calculated for you.</p>}
      {importing && <ImportDialog scope={scope} comps={comps} revision={meta.revision} onClose={() => setImporting(false)} onDone={s => { loaded.current = true; load(s); setImporting(false); setMsg({ ok: true, text: 'Imported as draft. Review, then save or submit.' }); qc.invalidateQueries({ queryKey: ['er-context'] }); }} />}
    </div>
  );
}

function ImportDialog({ scope, comps, revision, onClose, onDone }: { scope: Scope; comps: Component[]; revision: number; onClose: () => void; onDone: (s: Sheet) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [b64, setB64] = useState('');
  const [prev, setPrev] = useState<ImportPreview | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const body = () => ({ scope, filename: file!.name, dataBase64: b64, components: comps, revision });
  const pick = async (f: File | null) => { setFile(f); setPrev(null); setErr(''); if (f) setB64(await fileToBase64(f)); };
  const run = async () => { if (!file) return; setBusy(true); setErr(''); try { setPrev(await examApi.importPreview(body())); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const confirmImport = async () => { if (!prev) return; setBusy(true); try { onDone(await examApi.importConfirm({ ...body(), digest: prev.digest })); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const canImport = prev && prev.validCount > 0 && prev.invalidCount === 0 && !prev.uncertain;
  return <Modal title="Import results" eyebrow="Preview before saving" onClose={onClose} viewport>
    <div className="space-y-4">
      <input type="file" aria-label="Result file" accept=".xlsx,.xls,.pdf" onChange={e => pick(e.target.files?.[0] ?? null)} data-testid="input-er-import-file" />
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Nothing is saved until you confirm. PDF import only reads rows that begin with the exact Student ID and exact Student Name, followed by exactly one number per component column. Any row that cannot be read exactly is flagged; use Excel or type scores in the table for those.</p>
      <Button onClick={run} disabled={!file || busy} testId="button-er-preview">{busy && !prev ? 'Checking...' : 'Preview import'}</Button>
      {err && <p role="alert" className="text-sm font-bold text-[hsl(var(--destructive))]">{err}</p>}
      {prev && <div className="space-y-3" data-testid="er-import-preview">
        <p className="text-sm font-bold">{prev.rows.length} rows detected: {prev.validCount} valid, {prev.invalidCount} invalid{prev.missingStudents.length ? `, ${prev.missingStudents.length} students missing from file` : ''}.</p>
        {prev.message && <p className="text-sm">{prev.message}</p>}
        {prev.uncertain && <p role="alert" className="rounded-lg bg-[hsl(35_83%_53%/.15)] p-3 text-sm font-bold">Some rows were read with uncertainty. Correct the file and try again, or use Excel.</p>}
        <div className="max-h-64 overflow-auto rounded-lg border border-[hsl(var(--border))]"><table className="w-full text-xs"><thead className="bg-[hsl(var(--muted)/.4)] text-left"><tr><th className="p-2">Row</th><th className="p-2">Student</th><th className="p-2">Scores</th><th className="p-2">Result</th></tr></thead><tbody>
          {prev.rows.map(r => <tr key={r.sourceRow} className="border-t border-[hsl(var(--border)/.6)]"><td className="p-2">{r.sourceRow}</td><td className="p-2">{r.studentName}</td><td className="p-2">{comps.map(c => r.scores?.[c.key] ?? '-').join(' / ')}</td><td className={'p-2 font-bold ' + (r.status === 'INVALID' ? 'text-[hsl(var(--destructive))]' : '')}>{r.status === 'VALID' ? 'Valid' : r.issues.join('; ')}</td></tr>)}
        </tbody></table></div>
        {prev.missingStudents.length > 0 && <p className="text-xs">Not in file: {prev.missingStudents.join(', ')}</p>}
        {prev.invalidCount > 0 && <p className="text-xs font-bold text-[hsl(var(--destructive))]">Fix the invalid rows in your file and upload again. Invalid rows cannot be imported.</p>}
        <Button onClick={confirmImport} disabled={!canImport || busy} testId="button-er-import-confirm">Import results</Button>
      </div>}
    </div>
  </Modal>;
}
