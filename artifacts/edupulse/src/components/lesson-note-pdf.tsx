import { useEffect, useState } from 'react';
import { downloadLessonNotePdf, type LessonNoteDocument } from '@workspace/api-client-react';
import { Button } from '@/components/shared';
import { Notice, errMsg } from '@/components/school-ops-kit';
const pdfError=(error:unknown)=>error instanceof Error ? error.message : errMsg(error);

export async function checkLessonPdfFile(file: File) {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) throw Error('Choose a PDF file, not an image or document renamed as PDF.');
  if (!file.size || file.size > 10 * 1024 * 1024) throw Error('Lesson-note PDFs must be no larger than 10 MB.');
  const header = await file.slice(0, 8).text(), tail = await file.slice(Math.max(0,file.size-1024)).text();
  if (!/^%PDF-(1\.[0-9]|2\.0)/.test(header) || !/%%EOF\s*$/.test(tail)) throw Error('This file is not a valid PDF. Renamed or damaged files are rejected.');
}
export function LessonNotePdfPanel({ schoolId,noteId,documents=[],file,onFile,readOnly=false,disabled=false }:
  {schoolId:number;noteId:number|null;documents?:LessonNoteDocument[];file?:File|null;onFile?:(file:File|null)=>void;readOnly?:boolean;disabled?:boolean}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[previewName,setPreviewName]=useState('');
  useEffect(()=>{setUrl('');if(!file)return;const local=URL.createObjectURL(file);setUrl(local);setPreviewName(file.name);return()=>URL.revokeObjectURL(local);},[file]);
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
  const open=async(d:LessonNoteDocument,download=false)=>{
    setBusy(true);setError('');
    try {
      const blob=await downloadLessonNotePdf(schoolId,noteId!,d.id,{responseType:'blob'});
      if(!(blob instanceof Blob))throw Error('The server did not return a PDF.');
      const next=URL.createObjectURL(blob);
      if(download){const a=document.createElement('a');a.href=next;a.download=d.filename;a.click();setTimeout(()=>URL.revokeObjectURL(next),1000);}
      else{setUrl(next);setPreviewName(d.filename);}
    }catch(e){setError(pdfError(e));}finally{setBusy(false);}
  };
  return <div className="mt-6 space-y-3 rounded-xl border border-[hsl(var(--border))] p-4" data-testid="panel-note-pdf">
    <h3 className="font-bold">Lesson-note PDF (optional)</h3>
    {!readOnly&&<><p className="text-sm text-[hsl(var(--muted-foreground))]">Write the structured note below or upload a prepared PDF. Select a curriculum topic first. PDF only, up to 10 MB. Saving or submitting securely attaches the file; earlier versions are retained.</p>
      <input type="file" accept=".pdf,application/pdf" disabled={disabled} data-testid="input-note-pdf" onChange={async e=>{
        const picked=e.target.files?.[0];setError('');if(!picked)return;
        try{await checkLessonPdfFile(picked);onFile?.(picked);}catch(err){setError(pdfError(err));e.target.value='';}
      }}/>
      {file&&<div className="flex items-center gap-3 text-sm" data-testid="text-pending-pdf"><span>{file.name} — ready to attach</span><Button variant="outline" onClick={()=>onFile?.(null)} disabled={disabled}>Remove unsaved file</Button></div>}
    </>}
    {documents.length>0&&<ul className="space-y-2" data-testid="list-note-pdf-history">{documents.map((d,i)=><li key={d.id} className="flex flex-wrap items-center gap-3 text-sm" data-testid={`pdf-version-${d.id}`}>
      <span>{i===0?'Current PDF':'Earlier PDF'} · {d.filename} · revision {d.noteRevision}</span>
      <Button variant="outline" disabled={busy} onClick={()=>void open(d)} testId={`button-preview-pdf-${d.id}`}>Preview</Button>
      <Button variant="outline" disabled={busy} onClick={()=>void open(d,true)} testId={`button-download-pdf-${d.id}`}>Download</Button>
    </li>)}</ul>}
    {error&&<Notice tone="error"><span role="alert" data-testid="text-pdf-error">{error}</span></Notice>}
    {url&&<div data-testid="preview-note-pdf"><p className="mb-2 text-sm">{previewName}</p><iframe title="Lesson-note PDF preview" src={url} className="h-[480px] w-full rounded-lg border" /></div>}
    {readOnly&&!documents.length&&<p className="text-sm text-[hsl(var(--muted-foreground))]">No PDF attached; this is a structured lesson note.</p>}
  </div>;
}
