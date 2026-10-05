// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
const state=vi.hoisted(()=>({navigate:vi.fn(),load:vi.fn(),write:vi.fn()}));
vi.mock('wouter',()=>({useLocation:()=>['/communication/threads/3',state.navigate]}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:vi.fn()})}));
vi.mock('@workspace/api-client-react',()=>({
  useGetParentCommunicationThread:(id:number)=>{state.load(id);return{data:{subject:'Development message',childName:'Test student',schoolName:'Test school',messages:[],unreadCount:0,archived:true}};},
  getGetParentCommunicationThreadQueryKey:(id:number)=>['thread',id],
  getListParentMessageThreadsQueryKey:()=>['threads'],
  useReplyToParentCommunicationThread:()=>({mutateAsync:state.write}),
  useMarkParentCommunicationThreadRead:()=>({mutateAsync:state.write}),
  useArchiveParentCommunicationThread:()=>({mutateAsync:state.write}),
}));
vi.mock('@/components/shared',()=>({
  Button:(p:any)=><button onClick={p.onClick}>{p.children}</button>,
  ErrorState:()=> <div data-testid="invalid-thread">Unavailable</div>,
  SkeletonPage:()=>null,date:()=>'',time:()=>'',cx:()=>'',EmptyState:()=>null,Field:()=>null,Modal:()=>null,StatusPill:()=>null,
}));
vi.mock('../security/ui',()=>({inputClass:'',Notice:(p:any)=><div>{p.children}</div>}));
vi.mock('../security/security-contract',()=>({newKey:()=> 'test-key',safeMessage:()=>''}));
import {ThreadLinkPage} from './threads';
let root:Root,el:HTMLDivElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{vi.clearAllMocks();el=document.createElement('div');document.body.appendChild(el);root=createRoot(el);});
afterEach(async()=>{await act(async()=>root.unmount());el.remove();});
describe('existing notification thread links',()=>{
  it('loads the exact existing thread and returns Parents to their communication centre without sending',async()=>{
    await act(async()=>root.render(<ThreadLinkPage threadId="3" parent />));
    expect(state.load).toHaveBeenCalledWith(3);
    expect(el.textContent).toContain('Development message');
    await act(async()=>{el.querySelector('button')!.click();});
    expect(state.navigate).toHaveBeenCalledWith('/parent/communication');
    expect(state.write).not.toHaveBeenCalled();
  });
  it('returns school actors to the existing communications page',async()=>{
    await act(async()=>root.render(<ThreadLinkPage threadId="3" />));
    await act(async()=>{el.querySelector('button')!.click();});
    expect(state.navigate).toHaveBeenCalledWith('/communications');
    expect(state.write).not.toHaveBeenCalled();
  });
  it.each(['0','-1','3evil','1e2','9007199254740993'])('does not fetch an invalid thread identifier %s',async(threadId)=>{
    await act(async()=>root.render(<ThreadLinkPage threadId={threadId} parent />));
    expect(el.querySelector('[data-testid="invalid-thread"]')).not.toBeNull();
    expect(state.load).not.toHaveBeenCalled();
  });
});
