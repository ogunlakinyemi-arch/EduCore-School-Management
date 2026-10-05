// @vitest-environment jsdom
import { File } from 'node:buffer';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe,it,expect,vi } from 'vitest';
vi.mock('@workspace/api-client-react',()=>({downloadLessonNotePdf:vi.fn()}));
vi.mock('@/components/shared',()=>({Button:()=>null}));
vi.mock('@/components/school-ops-kit',()=>({Notice:(p:any)=><div>{p.children}</div>,errMsg:()=> 'Generic failure'}));
import { checkLessonPdfFile,LessonNotePdfPanel } from './lesson-note-pdf';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
describe('PDF upload feedback',()=>{
  it.each([
    ['renamed text',new File(['not PDF'],'renamed.pdf',{type:'application/pdf'}),'not a valid PDF'],
    ['oversized PDF',new File([new Uint8Array(10*1024*1024+1)],'large.pdf',{type:'application/pdf'}),'no larger than 10 MB'],
  ])('shows specific %s feedback instead of a generic error',async(_label,file,text)=>{
    const el=document.createElement('div');document.body.appendChild(el);const root=createRoot(el),onFile=vi.fn();
    await act(async()=>root.render(<LessonNotePdfPanel schoolId={1} noteId={null} onFile={onFile}/>));
    const input=el.querySelector('input')!;
    Object.defineProperty(input,'files',{value:[file],configurable:true});
    await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,10));});
    expect(el.querySelector('[data-testid="text-pdf-error"]')?.textContent).toContain(text);
    expect(onFile).not.toHaveBeenCalled();
    await act(async()=>root.unmount());el.remove();
  });
  it('checks the name and size before accepting PDF-shaped content',async()=>{
    await expect(checkLessonPdfFile(new File(['%PDF-1.7\n%%EOF'],'test.pdf',{type:'application/pdf'}) as unknown as globalThis.File)).resolves.toBeUndefined();
    await expect(checkLessonPdfFile(new File(['%PDF-1.7\n%%EOF'],'test.txt',{type:'text/plain'}) as unknown as globalThis.File)).rejects.toThrow('Choose a PDF');
  });
});
