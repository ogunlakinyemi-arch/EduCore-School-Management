import {beforeEach,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
const f=vi.hoisted(()=>({context:{} as any,catalog:vi.fn()}));
vi.mock('@clerk/react',()=>({useUser:()=>({user:{id:'fictional-owner'}}),useAuth:()=>({})}));
vi.mock('@workspace/api-client-react',async original=>({
  ...await original<typeof import('@workspace/api-client-react')>(),
  useGetAuthorizedContext:()=>({data:f.context}),
  useListSchools:()=>({data:[]}),
}));
vi.mock('@/components/shared',async original=>({
  ...await original<typeof import('@/components/shared')>(),useTenant:()=>({schoolId:77}),
}));
vi.mock('@/hooks/use-reporting-api',async original=>({
  ...await original<typeof import('@/hooks/use-reporting-api')>(),
  useReportCatalog:(...args:any[])=>{f.catalog(...args);return {data:{items:[
    {id:'financial-insights',title:'Financial Insights',filters:['schoolId','from','to','sessionId','termId']},
    {id:'current-platform-finance',title:'Current platform collections',filters:['schoolId','from','to','sessionId','termId']},
    {id:'subscriptions',title:'Subscription records',filters:['schoolId','from','to']},
    {id:'students',title:'Unrelated student report',filters:[]},
  ]}};},
  useReportResult:()=>({isLoading:true}),useReportFilterOptions:()=>({data:{options:{},truncated:[],requiresSchool:true}}),
}));
import {OwnerFinancialInsightsPage} from './reporting';
beforeEach(()=>{
 f.context={isPlatformOwner:true,user:{id:1,status:'ACTIVE'},roles:[{role:'PLATFORM_OWNER',schoolId:null,status:'ACTIVE'}]};
 f.catalog.mockClear();
});
it('opens all-schools Financial Insights independently of an operational school selection',()=>{
 const html=renderToStaticMarkup(<OwnerFinancialInsightsPage/>);
 expect(html).toContain('Financial Insights.');expect(html).toContain('All schools by default');
 expect(html).toContain('Current platform collections');expect(html).not.toContain('Unrelated student report');
 expect(f.catalog.mock.calls[0][0]).toMatchObject({roleScope:'PLATFORM_OWNER',tenantSchoolId:0});
});
it.each(['SCHOOL_ADMIN','ACCOUNTANT','PARENT','TEACHER','PARTNER','COMPANY_ACCOUNTANT'])('never mounts financial queries for %s',role=>{
 f.context={isPlatformOwner:false,user:{status:'ACTIVE'},roles:[{role,status:'ACTIVE',schoolId:77}]};
 expect(renderToStaticMarkup(<OwnerFinancialInsightsPage/>)).toContain('only to the Platform Owner');
 expect(f.catalog).not.toHaveBeenCalled();
});
it('requires an active global Owner, not just a display flag or a school-scoped membership',()=>{
 for(const context of [
   {...f.context,user:{status:'INACTIVE'}},
   {...f.context,roles:[{role:'PLATFORM_OWNER',schoolId:77,status:'ACTIVE'}]},
   {...f.context,roles:[{role:'PLATFORM_OWNER',schoolId:null,status:'INACTIVE'}]},
 ]){
   f.context=context;
   expect(renderToStaticMarkup(<OwnerFinancialInsightsPage/>)).toContain('only to the Platform Owner');
 }
 expect(f.catalog).not.toHaveBeenCalled();
});
