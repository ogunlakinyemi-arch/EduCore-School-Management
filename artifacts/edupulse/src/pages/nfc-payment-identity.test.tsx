// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({view:vi.fn(),simulate:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({
  viewPublicNfcPaymentLink:api.view,simulateNfcPaymentLink:api.simulate,
  checkoutPublicNfcPaymentLink:vi.fn(),verifyPublicNfcPaymentLink:vi.fn(),
}));
import PublicNfcPaymentPage from './public-nfc-payment';
let host:HTMLDivElement,root:Root;
const fixture=(studentName:string,studentIdentifier:string)=>({
  reference:`NFC_${studentIdentifier}`,studentName,studentIdentifier,schoolName:'Fictional School',
  termName:'First Term',sessionName:'Session',mode:'DEVELOPMENT_SIMULATION',status:'PENDING',
  amountMinor:500000,amountDueMinor:500000,expiresAt:'2099-01-01T00:00:00Z',
});
const tokenA='a'.repeat(43),tokenB='b'.repeat(43);
async function changeToken(token:string){
  await act(async()=>{history.replaceState(null,'',`#${token}`);window.dispatchEvent(new HashChangeEvent('hashchange'));});
}
beforeEach(()=>{
  vi.clearAllMocks();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  history.replaceState(null,'',`#${tokenA}`);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('switches same-tab payment fragments and ignores an older delayed student response',async()=>{
  let resolveOld!:(value:unknown)=>void;
  api.view.mockImplementation(({token})=>token===tokenA?new Promise(resolve=>{resolveOld=resolve;}):
    Promise.resolve(fixture('Bola Example','ADM-000003')));
  await act(async()=>root.render(<PublicNfcPaymentPage/>));
  await changeToken(tokenB);
  expect(host.textContent).toContain('Bola Example');expect(host.textContent).toContain('ADM-000003');
  await act(async()=>resolveOld(fixture('Ada Example','ADM-000004')));
  expect(host.textContent).not.toContain('Ada Example');expect(host.textContent).not.toContain('ADM-000004');
  expect(host.textContent).toContain('Awaiting payment');expect(host.textContent).toContain('Development simulation');
  expect(api.view.mock.calls.map(call=>call[0])).toEqual([{token:tokenA},{token:tokenB}]);
});
it('clears the previous student when a new link cannot be resolved',async()=>{
  api.view.mockResolvedValueOnce(fixture('Ada Example','ADM-000004'))
    .mockRejectedValueOnce({status:404});
  await act(async()=>root.render(<PublicNfcPaymentPage/>));
  expect(host.textContent).toContain('Ada Example');
  await changeToken(tokenB);
  expect(host.textContent).not.toContain('Ada Example');expect(host.textContent).not.toContain('ADM-000004');
  expect(host.textContent).toContain('invalid or incomplete');
});
it('refuses actions for the previous token even before hashchange is delivered',async()=>{
  api.view.mockResolvedValue(fixture('Ada Example','ADM-000004'));
  await act(async()=>root.render(<PublicNfcPaymentPage/>));
  history.replaceState(null,'',`#${tokenB}`);
  await act(async()=>{
    [...host.querySelectorAll('button')].find(button=>button.textContent==='Simulate success')!.click();
  });
  expect(api.simulate).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('Ada Example');
});
