import {beforeEach,describe,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({paid:true,oldStatus:"lost",captured:true,reserved:false,otherCard:false,created:false,issued:false,queries:[] as string[],args:[] as any[]}));
vi.mock("@workspace/db",()=>{
  const query=async(sql:string,values:any[]=[])=>{
    state.queries.push(sql);state.args.push(values);
    const rows=(rows:any[]=[])=>({rows});
    if(["BEGIN","COMMIT","ROLLBACK"].includes(sql)||sql.includes("pg_advisory_xact_lock"))return rows();
    if(sql.includes("SELECT * FROM student_nfc_replacement_requests"))return rows([{id:1,school_id:2,student_id:3,employee_id:null,old_card_id:5,invoice_id:8,status:"REQUESTED",reason:"DAMAGED: Chip cracked"}]);
    if(sql.includes("FROM student_nfc_replacement_requests r"))return rows([{id:1,paymentStatus:state.paid?"PAID":"UNPAID",status:state.issued?"ISSUED":"REQUESTED"}]);
    if(sql.includes("SELECT id FROM fee_invoices"))return rows([{id:8}]);
    if(sql.includes("SELECT status,replaced_by_card_id"))return rows([{status:state.oldStatus,replaced_by_card_id:null}]);
    if(sql.includes("FROM schools"))return rows([{id:2}]);
    if(sql.includes("FROM platform_devices"))return rows([{id:7}]);
    if(sql.includes("SELECT id FROM students"))return rows([{id:3}]);
    if(sql.includes("SELECT id FROM audit_logs"))return rows(state.captured?[{id:10}]:[]);
    if(sql.includes("SELECT id FROM nfc_cards WHERE lower"))return rows(state.reserved?[{id:20}]:[]);
    if(sql.includes("INSERT INTO nfc_cards")){state.created=true;return rows([{id:9,uid:"11223344",school_id:2}]);}
    if(sql.includes("SELECT * FROM nfc_cards WHERE id="))return rows([{id:5,uid:"AABBCCDD",school_id:2,student_id:3,status:state.oldStatus,replaced_by_card_id:null}]);
    if(sql.includes("SELECT * FROM nfc_cards WHERE lower"))return rows(state.created?[{id:9,uid:"11223344",school_id:2,student_id:null,status:"unassigned"}]:[]);
    if(sql.includes("SELECT 1 FROM nfc_card_history"))return rows(state.otherCard?[{}]:[]);
    if(sql.includes("UPDATE student_nfc_replacement_requests")){state.issued=true;return rows();}
    if(sql.includes("UPDATE nfc_cards")||sql.includes("INSERT INTO nfc_card_history")||sql.includes("INSERT INTO audit_logs"))return rows();
    throw new Error(sql);
  };
  return {pool:{query,connect:async()=>({query,release:vi.fn()})}};
});
vi.mock("../middlewares/auth",()=>({
  AuthError:class extends Error{constructor(public statusCode:number,message:string){super(message);}},
  assertRoles:vi.fn(),isPlatformOwner:()=>true,getUserContext:()=>({user:{id:11,email:"owner@example.test"},roles:[{role:"PLATFORM_OWNER"}]}),
}));
vi.mock("../routes/fee-provider-webhooks",()=>({settleVerifiedPayment:vi.fn()}));
vi.mock("./communication-service",()=>({emitDomainParentEvent:vi.fn()}));
import {issueReplacement} from "./student-card-replacement";
beforeEach(()=>Object.assign(state,{paid:true,oldStatus:"lost",captured:true,reserved:false,otherCard:false,created:false,issued:false,queries:[],args:[]}));
describe("existing replacement payment rules with captured inventory (mock DB/provider)",()=>{
  it("refuses unpaid replacement before reserving any captured UID",async()=>{
    state.paid=false;await expect(issueReplacement({} as any,1,"11223344",true)).rejects.toMatchObject({statusCode:409});
    expect(state.created).toBe(false);expect(state.queries.at(-1)).toBe("ROLLBACK");
  });
  it("requires explicit old-card revocation before capture selection",async()=>{
    state.oldStatus="active";await expect(issueReplacement({} as any,1,"11223344",true)).rejects.toMatchObject({statusCode:409});
    expect(state.created).toBe(false);
  });
  it.each(["captured","reserved","otherCard"] as const)("fails closed on %s conflict",async key=>{
    if(key==="captured")state.captured=false;else state[key]=true;
    await expect(issueReplacement({} as any,1,"11223344",true)).rejects.toMatchObject({statusCode:409});
    expect(state.queries.at(-1)).toBe("ROLLBACK");expect(state.issued).toBe(false);
  });
  it("preserves paid issuance, old/new UIDs, reason, history, actor and atomic commit",async()=>{
    expect(await issueReplacement({} as any,1,"11223344",true)).toMatchObject({status:"ISSUED"});
    expect(state.created).toBe(true);expect(state.issued).toBe(true);
    expect(state.args.some(a=>a.some((v:any)=>typeof v==="string"&&v.includes("DAMAGED: Chip cracked")))).toBe(true);
    const audit=state.args.flat().find(v=>v && typeof v==="object" && "oldUid" in v);
    expect(audit).toMatchObject({oldCardId:5,oldUid:"AABBCCDD",newCardId:9,newUid:"11223344",reason:"DAMAGED: Chip cracked"});
    expect(state.queries.at(-1)).toBe("COMMIT");
  });
});
