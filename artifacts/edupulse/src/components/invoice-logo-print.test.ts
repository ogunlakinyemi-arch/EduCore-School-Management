// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
const fetchLogo=vi.hoisted(()=>vi.fn());
vi.mock('@workspace/api-client-react',()=>({
  customFetch:fetchLogo,getGetSchoolBrandingQueryKey:vi.fn(),useGetSchoolBranding:vi.fn(),
}));
import {embedPrintLogos} from './school-document';
beforeEach(()=>{fetchLogo.mockReset();document.body.innerHTML='<article>Invoice 123<img data-print-logo="true" src="/api/schools/1/branding/logo"></article>';});
it('embeds the private logo through the existing authenticated client',async()=>{
  fetchLogo.mockResolvedValue(new Blob(['fixture'],{type:'image/png'}));
  await embedPrintLogos(document);
  expect(fetchLogo).toHaveBeenCalledWith('/api/schools/1/branding/logo',expect.objectContaining({responseType:'blob',redirect:'error'}));
  expect(document.querySelector('img')!.src).toMatch(/^data:image\/png;base64,/);
});
it('keeps the invoice printable without a logo on access or storage failure',async()=>{
  fetchLogo.mockRejectedValue(new Error('Unauthorized'));
  await expect(embedPrintLogos(document)).resolves.toBeUndefined();
  expect(document.querySelector('img')).toBeNull();
  expect(document.body.textContent).toContain('Invoice 123');
});
it('does not send authenticated requests to an external logo origin',async()=>{
  document.querySelector('img')!.src='https://external.invalid/logo.png';
  await embedPrintLogos(document);
  expect(fetchLogo).not.toHaveBeenCalled();expect(document.querySelector('img')).toBeNull();
});
