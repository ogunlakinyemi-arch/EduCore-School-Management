import {beforeAll,afterAll,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
const state=vi.hoisted(()=>({pool:null as any,invitation:null as any}));
vi.mock("@workspace/db",()=>({pool:{
  query:(...args:any[])=>state.pool.query(...args),
  connect:()=>state.pool.connect(),
}}));
vi.mock("@clerk/express",()=>({clerkClient:{
  invitations:{
    createInvitation:async(input:any)=>{
      state.invitation={id:"inv_native_sql_"+Date.now(),status:"pending",emailAddress:input.emailAddress,
        publicMetadata:input.publicMetadata,createdAt:Date.now()};
      return state.invitation;
    },
    getInvitationList:async()=>({data:state.invitation?[state.invitation]:[]}),
    revokeInvitation:async()=>({}),
  },
  users:{getUserList:async()=>({data:[]})},
}}));
import {createRequire} from "node:module";
const {Pool}=createRequire(new URL("../../../../lib/db/package.json",import.meta.url))("pg");
import {createSchoolWithAdministrator} from "./school-invitations";
describe.skipIf(process.env.RUN_ISOLATED_SCHOOL_REGISTRATION!=="1")("native SQL school registration / simulated provider",()=>{
  let actor:any,partnerId:number;
  beforeAll(async()=>{
    state.pool=new Pool({host:"/tmp",port:55434,user:"postgres",database:"postgres",max:4});
    const target=(await state.pool.query("SELECT current_setting('data_directory') dir,inet_server_addr() host")).rows[0];
    if(target.dir!=="/tmp/educore-replacement-pgdata" || target.host!==null) throw Error("Disposable cloned schema only");
    const nonce=randomUUID();
    const user=(await state.pool.query("INSERT INTO app_users(clerk_user_id,email,first_name,last_name) VALUES($1,$2,'QA','Partner') RETURNING id",
      ["user_isolated_"+nonce,"isolated-"+nonce+"@example.test"])).rows[0];
    const partner=(await state.pool.query("INSERT INTO partner_profiles(partner_code,full_name,email,status) VALUES($1,'Isolated QA Partner',$2,'ACTIVE') RETURNING id",
      ["QA-"+nonce.slice(0,8),"partner-"+nonce+"@example.test"])).rows[0];
    partnerId=partner.id;
    actor={user:{id:user.id,clerkUserId:"user_isolated_"+nonce,email:"isolated-"+nonce+"@example.test",firstName:"QA",lastName:"Partner",status:"ACTIVE"},
      roles:[{role:"PARTNER",schoolId:null,status:"ACTIVE"}]};
  });
  afterAll(async()=>{await state.pool?.end()});
  it("executes real staged school, attribution and invitation audit SQL",async()=>{
    const nonce=randomUUID();
    const result=await createSchoolWithAdministrator({
      school:{name:"Isolated Native School "+nonce,city:"Lagos",state:"Lagos"},
      administrator:{fullName:"QA School Administrator",email:"admin-"+nonce+"+clerk_test@example.test",phone:"08000000000"},
      partnerId,
    },actor);
    expect(result.schoolId).toBeGreaterThan(0);
    expect((await state.pool.query("SELECT source FROM school_partner_attributions WHERE school_id=$1",[result.schoolId])).rows[0].source).toBe("PARTNER_DIRECT");
  });
});