// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('@clerk/react',()=>({useAuth:()=>({userId:'fictional-admin'})}));
vi.mock('@workspace/api-client-react',()=>({
  customFetch:api.fetch,useGetAuthorizedContext:()=>({data:{roles:[{role:'SCHOOL_ADMIN',status:'ACTIVE',schoolId:1}]}}),
}));
vi.mock('@/components/shared',()=>({
  Button:({children,testId,variant:_variant,...props}:any)=><button data-testid={testId} {...props}>{children}</button>,
  Modal:({children}:any)=><div role="dialog">{children}</div>,
  Field:({label,children}:any)=><label>{label}{children}</label>,
}));
import {AssistedNfcPayment} from './assisted-nfc-payment';
it('confirms the server-resolved student identity, not a stale browser name or guardian fields',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const link={studentName:'Ada Example',studentIdentifier:'ADM-000004',schoolName:'Fictional School',
    termName:'First Term',sessionName:'Session',reference:'NFC_fixture',status:'PENDING',amountMinor:500000,
    expiresAt:'2099-01-01T00:00:00Z',paymentUrl:'https://development.example.invalid/nfc/pay#fictional-token'};
  api.fetch.mockImplementation(async(url:string)=>url.includes('assisted-options')?{
    students:[{id:1,firstName:'Stale',lastName:'Name',admissionNo:'ADM-000004',className:'Class',section:'A',
      parents:[{name:'Private Guardian',phone:'private-phone',relationshipType:'Guardian'}]}],
    terms:[{id:1,name:'First Term',sessionName:'Session'}],amountMinor:500000,
  }:link);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<QueryClientProvider client={client}><AssistedNfcPayment schoolId={1}/></QueryClientProvider>));
    await act(async()=>{host.querySelector('button')!.click();await new Promise(r=>setTimeout(r,20));});
    for(const selector of ['select-assisted-student','select-assisted-term']){
      await act(async()=>{
        const select=host.querySelector(`[data-testid="${selector}"]`) as HTMLSelectElement;
        select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));
      });
    }
    await act(async()=>{
      host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      await new Promise(r=>setTimeout(r,20));
    });
    const confirmation=host.querySelector('[data-testid="assisted-nfc-result"]')!;
    expect(confirmation.textContent).toContain('Ada Example');
    expect(confirmation.textContent).toContain('ADM-000004');
    expect(confirmation.textContent).toContain('Fictional School');
    expect(confirmation.textContent).toContain('pending; nothing has been paid or verified');
    expect(confirmation.textContent).not.toMatch(/Stale Name|Private Guardian|private-phone/);
    expect(confirmation.querySelector('a')?.getAttribute('href')).toBe(link.paymentUrl);
    const request=api.fetch.mock.calls.find(([url])=>String(url).includes('assisted-requests'))!;
    expect(JSON.parse(request[1].body)).toEqual({studentId:1,termId:1});
  }finally{await act(async()=>root.unmount());client.clear();host.remove();}
});
