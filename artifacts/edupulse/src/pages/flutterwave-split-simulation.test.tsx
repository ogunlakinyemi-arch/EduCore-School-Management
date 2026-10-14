// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({userId:'unit-owner' as string|null,loaded:true,preview:vi.fn(),action:vi.fn()}));
vi.mock('@clerk/react',()=>({useAuth:()=>({userId:f.userId,isLoaded:f.loaded})}));
vi.mock('@/components/shared',()=>({
  PageHeading:({title,description}:any)=><h1>{title}{description}</h1>,
  Button:({testId,variant:_v,children,...p}:any)=><button data-testid={testId} {...p}>{children}</button>,
  SkeletonPage:()=><p>TEST / NOT REAL loading</p>,
  EmptyState:({title}:any)=><p>{title}</p>,
  ErrorState:({message}:any)=><p role="alert">{message}</p>,
  money:(n:number)=>`NGN ${n.toLocaleString('en-NG')}`,
}));
vi.mock('@workspace/api-client-react',async()=>{
  const {useQuery,useMutation}=await import('@tanstack/react-query');
  return {
    getGetLocalFlutterwaveSplitSimulationQueryKey:()=>['local-simulation'],
    useGetLocalFlutterwaveSplitSimulation:(opts:any)=>useQuery({...opts.query,queryFn:f.preview}),
    useRunLocalFlutterwaveSplitSimulation:()=>useMutation({mutationFn:f.action}),
  };
});
import {FlutterwaveSplitSimulationPage} from './flutterwave-split-simulation';
const fixture=()=>({
  mode:'LOCAL_SPLIT_SIMULATION',label:'TEST / NOT REAL',exampleSchoolId:1496,exampleSchoolName:'Academic Calendar QA — reference only',
  simulationRecipientId:'SIMULATION_NOT_REAL_RECIPIENT_1496',fictionalBusiness:'TEST / NOT REAL — Fictional recipient',
  fictionalContact:'qa@fixture.invalid',fictionalPhone:'SIMULATION_NOT_REAL_PHONE',fictionalBank:'TEST / NOT REAL — NO BANK',
  fictionalBankCode:'SIMULATION_NOT_REAL_BANK',fictionalAccount:'SIMULATION_NOT_REAL_ACCOUNT',recipientState:'LOCAL_ONLY_UNVERIFIED',
  reviewedForSimulation:false,simulatedEnabled:false,operationalEnabled:false,testReady:false,ownershipVerified:false,
  providerVerified:false,checkoutAllowed:false,webhooksAllowed:false,allocationProven:false,bankSettlementVerified:false,
  providerFeesIncluded:false,noPartner:true,simulationTotalMinor:500000,simulationSchoolMinor:200000,simulationPlatformGrossMinor:300000,
  notice:'TEST / NOT REAL. In-memory only. No real records or provider verification.',
});
let root:Root,host:HTMLDivElement,client:QueryClient;
const node=(id:string)=>host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
async function settle(){await act(async()=>{await new Promise(r=>setTimeout(r,15));});}
async function render(wrap?:(children:React.ReactNode)=>React.ReactNode){
  const page=<FlutterwaveSplitSimulationPage/>;
  await act(async()=>root.render(<QueryClientProvider client={client}>{wrap?wrap(page):page}</QueryClientProvider>));await settle();
}
async function click(id:string){await act(async()=>node(id).click());await settle();}
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;f.userId='unit-owner';f.loaded=true;
  f.preview.mockReset().mockResolvedValue(fixture());
  f.action.mockReset().mockImplementation(async({data}:any)=>({...fixture(),
    reviewedForSimulation:['REVIEW','ENABLE'].includes(data.action),simulatedEnabled:data.action==='ENABLE'}));
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Network forbidden in simulation UI tests');}));
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();vi.unstubAllGlobals();});
describe('TEST / NOT REAL isolated local simulation screen',()=>{
  it('labels fiction, excludes fees and shows the exact no-partner gross shares',async()=>{
    await render();
    expect(host.textContent).toContain('TEST / NOT REAL');
    expect(host.textContent).toContain('qa@fixture.invalid');
    for(const amount of ['NGN 5,000','NGN 2,000','NGN 3,000'])expect(host.textContent).toContain(amount);
    expect(host.textContent).toContain('Provider fees are excluded');
    expect(host.textContent).toContain('No real allocation or settlement is proven');
    expect(host.textContent).toContain('Never TEST_READY');
    expect(Array.from(host.querySelectorAll('button')).every(x=>x.textContent?.includes('TEST / NOT REAL'))).toBe(true);
    expect(f.action).not.toHaveBeenCalled();
  });
  it('exercises acknowledge, review, simulated enable, disable and reset without operational hooks',async()=>{
    await render();
    expect((node('simulation-review') as HTMLButtonElement).disabled).toBe(true);
    await click('simulation-ack');
    expect((node('simulation-enable') as HTMLButtonElement).disabled).toBe(true);
    await click('simulation-review');await click('simulation-review-confirm');await click('simulation-enable');
    expect(node('simulation-state').textContent).toContain('ON');
    expect(f.action.mock.calls[1][0]).toEqual({data:{mode:'LOCAL_SPLIT_SIMULATION',exampleSchoolId:1496,action:'ENABLE',acknowledgeFictional:true}});
    await click('simulation-disable');expect(node('simulation-state').textContent).toContain('OFF');
    expect((node('simulation-ack') as HTMLInputElement).checked).toBe(false);
    await click('simulation-reset');expect(node('simulation-state').textContent).toContain('OFF');
  });
  it('keeps controls disabled while a local action is pending',async()=>{
    f.action.mockReturnValue(new Promise(()=>{}));await render();await click('simulation-ack');await click('simulation-review');await click('simulation-review-confirm');
    for(const id of ['simulation-review','simulation-enable','simulation-disable','simulation-reset'])expect((node(id) as HTMLButtonElement).disabled).toBe(true);
    expect(host.textContent).toContain('processing local simulation action');
  });
  it('reports action failure without assuming enablement succeeded',async()=>{
    f.action.mockRejectedValue(new Error('unit-only failure'));
    await render();await click('simulation-ack');await click('simulation-review');await click('simulation-review-confirm');
    expect(host.querySelector('[role=alert]')?.textContent).toContain('No operational settings were changed');
    expect(node('simulation-state').textContent).toContain('OFF');
  });
  it.each([403,404,503])('hides fictional controls on denied/unavailable preview %s',async status=>{
    f.preview.mockRejectedValue({status});await render();
    expect(node('simulation-enable')).toBeNull();expect(host.textContent).toContain('simulation unavailable');
  });
  it('shows a labelled loading state without any controls',async()=>{
    f.preview.mockReturnValue(new Promise(()=>{}));await render();
    expect(host.textContent).toContain('TEST / NOT REAL loading');expect(node('simulation-enable')).toBeNull();
  });
  it('does not request data for a signed-out identity',async()=>{
    f.userId=null;await render();expect(f.preview).not.toHaveBeenCalled();
    expect(host.textContent).toContain('sign in required');expect(node('simulation-enable')).toBeNull();
  });
  it.each([{testReady:true},{operationalEnabled:true},{providerVerified:true},{simulationSchoolMinor:199999}])('rejects an unsafe response before displaying controls',async change=>{
    f.preview.mockResolvedValue({...fixture(),...change});await render();
    expect(host.textContent).toContain('safety contract rejected');expect(node('simulation-enable')).toBeNull();
  });
  it('does not carry fictional review, enabled state or acknowledgement across identities',async()=>{
    await render();await click('simulation-ack');await click('simulation-review');await click('simulation-review-confirm');await click('simulation-enable');
    f.userId='unit-second-owner';await render();
    expect(node('simulation-state').textContent).toContain('OFF');
    expect((node('simulation-ack') as HTMLInputElement).checked).toBe(false);
    expect((node('simulation-enable') as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps the readable review open without a mutation, timer dismissal or trigger toggling',async()=>{
    await render();await click('simulation-ack');await click('simulation-review');
    const panel=node('simulation-review-panel');
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('role')).toBe('region');
    expect(node('simulation-review').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.id).toBe('simulation-review-heading');
    expect(panel.textContent).toContain('LOCAL_ONLY_UNVERIFIED');
    expect(panel.textContent).toContain('NGN 5,000');
    expect(panel.textContent).toContain('NGN 2,000');
    expect(panel.textContent).toContain('NGN 3,000');
    await settle();await click('simulation-review');await settle();
    expect(node('simulation-review-panel')).toBe(panel);
    expect(f.action).not.toHaveBeenCalled();
    expect((node('simulation-enable') as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not dismiss or submit/navigate when the trigger, review contents or Close are clicked inside a form',async()=>{
    const submitted=vi.fn(),ancestorClick=vi.fn(),ancestorKey=vi.fn();
    await render(children=><form onSubmit={event=>{event.preventDefault();submitted();}}
      onClick={ancestorClick} onKeyDown={ancestorKey}>{children}</form>);
    await click('simulation-ack');
    ancestorClick.mockClear();
    const originalLocation=window.location.href;
    await click('simulation-review');
    const panel=node('simulation-review-panel');
    await act(async()=>{
      panel.querySelector('dd')!.click();
      panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    });
    expect(node('simulation-review-panel')).toBe(panel);
    expect(ancestorClick).not.toHaveBeenCalled();expect(ancestorKey).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
    expect(window.location.href).toBe(originalLocation);
    expect([...host.querySelectorAll('button')].every(button=>button.type==='button')).toBe(true);
    await click('simulation-review-close');
    expect(node('simulation-review-panel')).toBeNull();
    expect(document.activeElement).toBe(node('simulation-review'));
    expect(node('simulation-review').getAttribute('aria-expanded')).toBe('false');
    expect(submitted).not.toHaveBeenCalled();
    expect(f.action).not.toHaveBeenCalled();
  });
  it('keeps review open after outside clicks and query-cache updates',async()=>{
    await render();await click('simulation-ack');await click('simulation-review');
    const panel=node('simulation-review-panel');
    await act(async()=>{
      document.body.click();
      node('simulation-fixture').click();
      client.setQueryData(['local-simulation',f.userId],{...fixture()});
    });
    await settle();
    expect(node('simulation-review-panel')).toBe(panel);
    expect(f.action).not.toHaveBeenCalled();
  });
  it('keeps review mounted during and after explicit fictional confirmation',async()=>{
    let finish!:(value:ReturnType<typeof fixture>)=>void;
    f.action.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    await render();await click('simulation-ack');await click('simulation-review');
    const panel=node('simulation-review-panel');
    await click('simulation-review-confirm');
    expect(node('simulation-review-panel')).toBe(panel);
    expect((node('simulation-review-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect((node('simulation-review-close') as HTMLButtonElement).disabled).toBe(false);
    expect(f.action).toHaveBeenCalledTimes(1);
    expect(f.action.mock.calls[0][0].data.action).toBe('REVIEW');
    await act(async()=>{finish({...fixture(),reviewedForSimulation:true});});
    await settle();
    expect(node('simulation-review-panel')).toBe(panel);
    expect(node('simulation-review-recorded').textContent).toContain('Still local-only and unverified');
    expect(node('simulation-state').textContent).toContain('OFF');
  });
  it('keeps failed review contents readable until explicit Close and allows reopening',async()=>{
    f.action.mockRejectedValue(new Error('unit-only failure'));
    await render();await click('simulation-ack');await click('simulation-review');await click('simulation-review-confirm');
    expect(node('simulation-review-panel')).not.toBeNull();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('No operational settings were changed');
    await click('simulation-review-close');
    expect(node('simulation-review-panel')).toBeNull();
    await click('simulation-review');
    expect(node('simulation-review-panel')).not.toBeNull();
    expect(f.action).toHaveBeenCalledTimes(1);
  });
  it('does not reopen a review closed during an in-flight confirmation',async()=>{
    let finish!:(value:ReturnType<typeof fixture>)=>void;
    f.action.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    await render();await click('simulation-ack');await click('simulation-review');await click('simulation-review-confirm');
    await click('simulation-review-close');
    await act(async()=>{finish({...fixture(),reviewedForSimulation:true});});await settle();
    expect(node('simulation-review-panel')).toBeNull();
    expect(node('simulation-review').getAttribute('aria-expanded')).toBe('false');
  });
  it('closes review on an explicit reset without enabling the simulation',async()=>{
    await render();await click('simulation-ack');await click('simulation-review');await click('simulation-reset');
    expect(node('simulation-review-panel')).toBeNull();
    expect(node('simulation-state').textContent).toContain('OFF');
    expect(f.action.mock.calls.map(([arg])=>arg.data.action)).toEqual(['RESET']);
  });
  it('does not expose or reopen an earlier identity review after account switches',async()=>{
    await render();await click('simulation-ack');await click('simulation-review');
    f.userId='unit-second-owner';await render();
    expect(node('simulation-review-panel')).toBeNull();
    f.userId='unit-owner';await render();
    expect(node('simulation-review-panel')).toBeNull();
  });
  it.each([
    ['desktop',1440,1000],
    ['mobile',390,844],
    ['narrow mobile',320,740],
  ] as const)('preserves the review interaction in a controlled %s viewport (%ix%i)',async(_name,width,height)=>{
    // DOM interaction regression; actual CSS geometry is checked separately in
    // the network-disabled offline browser harness, not inferred from jsdom.
    vi.stubGlobal('innerWidth',width);vi.stubGlobal('innerHeight',height);
    const submitted=vi.fn();
    await render(children=><form onSubmit={event=>{event.preventDefault();submitted();}}>{children}</form>);
    await click('simulation-ack');await click('simulation-review');
    const panel=node('simulation-review-panel');
    expect(panel.textContent).toContain('TEST / NOT REAL');
    expect(panel.textContent).toContain('No Partner');
    for(const amount of ['NGN 5,000','NGN 2,000','NGN 3,000'])expect(panel.textContent).toContain(amount);
    await act(async()=>{panel.querySelector('dd')!.click();document.body.click();});
    await settle();
    expect(node('simulation-review-panel')).toBe(panel);
    await click('simulation-review-confirm');
    expect(node('simulation-review-panel')).toBe(panel);
    expect(node('simulation-review-recorded')).not.toBeNull();
    expect(submitted).not.toHaveBeenCalled();
    await click('simulation-review-close');
    expect(node('simulation-review-panel')).toBeNull();
    expect(f.action.mock.calls.map(([arg])=>arg.data.action)).toEqual(['REVIEW']);
  });
});
