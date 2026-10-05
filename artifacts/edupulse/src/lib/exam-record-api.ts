import { customFetch } from '@workspace/api-client-react';

import type * as G from '@workspace/api-client-react';

export type Scope = G.ExamRecordScope;
export type Assignment = G.ExamRecordAssignment;
export type GradingRule = G.ExamRecordGradingRule;
export type ErContext = G.ExamRecordContext;
export type Component = G.ExamRecordComponent;
export type SheetRow = G.ExamRecordSheetRow;
export type Sheet = G.ExamRecordSheet;
export type ImportPreview = G.ExamRecordImportPreview;
export type ClassStudent = G.ExamRecordClassStudent;
export type ClassView = G.ExamRecordClassView;
export type ClassComment = G.ExamRecordClassComment;
export type Paper = G.ExamRecordPaper;
export type PaperDetail = G.ExamRecordPaperDetail;

const qs = (o: object) => { const p = new URLSearchParams(); Object.entries(o as Record<string, unknown>).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); }); return p.toString(); };
const post = <T,>(url: string, body: unknown) => customFetch<T>(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, responseType: 'json' });
const get = <T,>(url: string) => customFetch<T>(url, { method: 'GET', responseType: 'json' });
const blob = (url: string) => customFetch<Blob>(url, { method: 'GET', responseType: 'blob' });
const B = '/api/exam-record';

export const examApi = {
  context: (p: { schoolId: number; sessionId?: number | null; termId?: number | null }) => get<ErContext>(`${B}/context?${qs(p)}`),
  sheet: (s: Scope) => get<Sheet>(`${B}/sheet?${qs(s)}`),
  saveDraft: (b: { scope: Scope; revision: number; components: Component[]; rows: SheetRow[] }) => post<Sheet>(`${B}/sheet/draft`, b),
  submit: (b: { schoolId: number; batchId: number; revision: number }) => post<{ status: string; revision: number }>(`${B}/sheet/submit`, b),
  template: (s: Scope) => blob(`${B}/template?${qs(s)}`),
  importPreview: (b: unknown) => post<ImportPreview>(`${B}/import/preview`, b),
  importConfirm: (b: unknown) => post<Sheet>(`${B}/import/confirm`, b),
  classView: (p: Record<string, unknown>) => get<ClassView>(`${B}/class?${qs(p)}`),
  returnBatch: (b: { schoolId: number; batchId: number; revision: number; comment: string }) => post<{ status: string; revision: number }>(`${B}/return`, b),
  classComments: (p: Record<string, unknown>) => get<ClassComment[]>(`${B}/class-comments?${qs(p)}`),
  saveClassComment: (b: G.ExamRecordClassCommentRequest) => post<ClassComment>(`${B}/class-comment`, b),
  publish: (b: Record<string, unknown>) => post<{ reportCardId: number; status: string }>(`${B}/publish`, b),
  papers: (p: Record<string, unknown>) => get<Paper[]>(`${B}/questions?${qs(p)}`),
  createPaper: (b: unknown) => post<Paper>(`${B}/questions`, b),
  paper: (id: number, schoolId: number) => get<PaperDetail>(`${B}/questions/${id}?${qs({ schoolId })}`),
  document: (id: number, schoolId: number, versionId?: number) => blob(`${B}/questions/${id}/document?${qs({ schoolId, versionId })}`),
  addVersion: (id: number, b: unknown) => post<Paper>(`${B}/questions/${id}/version`, b),
  submitPaper: (id: number, b: { schoolId: number; revision: number }) => post<{ status: string; revision: number }>(`${B}/questions/${id}/submit`, b),
  review: (id: number, b: { schoolId: number; revision: number; decision: 'RETURN' | 'APPROVE'; comment: string }) => post<{ status: string; revision: number }>(`${B}/questions/${id}/review`, b),
  print: (id: number, schoolId: number) => blob(`${B}/questions/${id}/print?${qs({ schoolId })}`),
};

export function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(new Error('Could not read file')); r.readAsDataURL(file); });
}
export function errMsg(e: unknown) {
  const d = (e as { data?: { error?: string; message?: string } })?.data;
  return d?.error || d?.message || (e instanceof Error ? e.message : 'Request failed');
}
export function saveBlob(b: Blob, name: string) { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
export const statusLabel = (s: string | null | undefined) => !s ? 'Awaiting' : ({ AWAITING: 'Awaiting', NOT_STARTED: 'Awaiting', READY_FOR_REVIEW: 'Ready for review', APPROVED: 'Approved - ready for printing' } as Record<string, string>)[s] ?? s.replaceAll('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
