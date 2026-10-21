// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({status:{} as any,owner:false,create:vi.fn(),copy:vi.fn(),invalidate:vi.fn()}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
vi.mock("@tanstack/react-query",()=>({useQueryClient:()=>({invalidateQueries:m.invalidate})}));
vi.mock("qrcode.react",()=>({QRCodeSVG:({value}:any)=><svg data-qr-value={value}/>}));
vi.mock("@workspace/api-client-react",()=>({
  useGetAuthorizedContext:()=>({data:{isPlatformOwner:m.owner}}),
  useGetParentTelegramInvitation:()=>({data:m.status,isError:false,refetch:vi.fn()}),
  getGetParentTelegramInvitationQueryKey:(id:number,p:any)=>["tg-invitation",id,p],
  useCreateParentTelegramInvitation:()=>({mutateAsync:m.create,isPending:false}),
}));
import {ParentTelegramDirectory} from "./parent-telegram-directory";
let root:Root,host:HTMLElement;
const url=`https://t.me/FixtureBot?start=${"A".repeat(43)}`;
const status={status:"Not invited",canInvite:true,expiresAt:null,pushAvailable:false};
const el=(schoolId=1,parentId=1)=><ParentTelegramDirectory schoolId={schoolId} parentId={parentId}/>;
const id=(name:string)=>host.querySelector(`[data-testid="${name}"]`) as HTMLElement;
const flush=()=>act(async()=>{await Promise.resolve();});
beforeEach(()=>{
  m.owner=false;m.status={...status};m.create.mockReset();m.copy.mockReset();m.invalidate.mockReset();
  host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:m.copy}});
  m.copy.mockResolvedValue(undefined);
});
afterEach(()=>{act(()=>root.unmount());host.remove();Reflect.deleteProperty(navigator,"clipboard");});
function open(){act(()=>root.render(el()));act(()=>id("button-parent-telegram-1").click());}
describe("School Admin Telegram invitations",()=>{
  it("shows status lazily, never creates on mount, and copies precisely the locally rendered QR link",async()=>{
    m.create.mockResolvedValue({...status,url,expiresAt:new Date(Date.now()+600000).toISOString()});
    act(()=>root.render(el()));expect(m.create).not.toHaveBeenCalled();
    act(()=>id("button-parent-telegram-1").click());
    expect(host.textContent).toContain("Not invited");expect(host.textContent).toContain("Push notification unavailable");
    act(()=>id("button-parent-telegram-generate-1").click());await flush();
    expect(m.create).toHaveBeenCalledWith({parentId:1,data:{schoolId:1}});
    expect(host.querySelector("svg")?.getAttribute("data-qr-value")).toBe(url);
    act(()=>id("button-parent-telegram-copy-1").click());await flush();
    expect(m.copy).toHaveBeenCalledWith(url);expect(host.textContent).toContain("Refresh invitation");
  });
  it.each(["Linked","Disabled/consent withdrawn","Delivery unavailable"])("does not offer linking controls for %s",state=>{
    m.status={...status,status:state,canInvite:false};open();
    expect(host.textContent).toContain(state);expect(id("button-parent-telegram-generate-1")).toBeNull();
  });
  it("refresh is explicit, malicious URLs are never rendered or copied, and Owners cannot act",async()=>{
    m.status={...status,status:"Invitation pending"};
    m.create.mockResolvedValue({...status,url:"https://evil.invalid/?token=unsafe",expiresAt:new Date(Date.now()+600000).toISOString()});
    open();expect(host.textContent).toContain("Refresh invitation");
    act(()=>id("button-parent-telegram-generate-1").click());await flush();
    expect(host.querySelector("svg")).toBeNull();expect(id("button-parent-telegram-copy-1")).toBeNull();
    m.owner=true;act(()=>root.render(el()));expect(host.textContent).toBe("");
  });
  it("discards invitation responses that arrive after switching school or parent",async()=>{
    let complete!:(value:any)=>void;m.create.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
    open();act(()=>id("button-parent-telegram-generate-1").click());
    act(()=>root.render(el(2,2)));
    await act(async()=>complete({...status,url,expiresAt:new Date(Date.now()+600000).toISOString()}));
    expect(host.querySelector("svg")).toBeNull();expect(host.textContent).not.toContain("Copy link");
  });
  it("removes expired invitation QR and copy controls",async()=>{
    vi.useFakeTimers();
    try{
      m.create.mockResolvedValue({...status,url,expiresAt:new Date(Date.now()+1000).toISOString()});
      open();act(()=>id("button-parent-telegram-generate-1").click());await flush();
      expect(host.querySelector("svg")).not.toBeNull();
      act(()=>vi.advanceTimersByTime(1100));
      expect(host.querySelector("svg")).toBeNull();expect(host.textContent).toContain("Invitation expired");
    }finally{vi.useRealTimers();}
  });
});
