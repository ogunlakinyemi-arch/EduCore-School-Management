import { beforeEach,describe,it,expect,vi } from "vitest";
const state=vi.hoisted(()=>({captured:true,reserved:false,student:true,active:true,prior:false,device:true,queries:[] as string[],values:[] as any[]}));
vi.mock("@workspace/db",()=>{
  const query=vi.fn(async(sql:string,values:any[]=[])=>{
    state.queries.push(sql);state.values.push(values);
    const rows=(rows:any[]=[])=>({rows});
    if(["BEGIN","COMMIT","ROLLBACK"].includes(sql)||sql.includes("pg_advisory_xact_lock"))return rows();
    if(sql.includes("FROM students"))return rows(state.student?[{id:3,status:state.active?"active":"inactive"}]:[]);
    if(sql.includes("FROM schools"))return rows([{id:2}]);
    if(sql.includes("FROM platform_devices"))return rows(state.device?[{id:9}]:[]);
    if(sql.includes("FROM audit_logs"))return rows(state.captured?[{id:1}]:[]);
    if(sql.includes("FROM nfc_cards WHERE school_id="))return rows(state.prior?[{id:5}]:[]);
    if(sql.includes("FROM nfc_cards WHERE lower"))return rows(state.reserved?[{id:5}]:[]);
    if(sql.includes("INSERT INTO nfc_cards"))return rows([{id:6,uid:values[1],school_id:values[0]}]);
    if(sql.startsWith("UPDATE nfc_cards")||sql.includes("INSERT INTO nfc_card_history")||sql.includes("INSERT INTO audit_logs"))return rows();
    throw new Error(sql);
  });
  return {pool:{connect:async()=>({query,release:vi.fn()})}};
});
vi.mock("../middlewares/auth",()=>({
  AuthError:class extends Error{constructor(public statusCode:number,message:string){super(message);}},
  assertRoles:vi.fn(),getUserContext:()=>({user:{id:7}}),
}));
import {assignCapturedUid,capturedUid,prepareCapturedUid} from "./uid-inventory-assignment";
import {pool} from "@workspace/db";
beforeEach(()=>Object.assign(state,{captured:true,reserved:false,student:true,active:true,prior:false,device:true,queries:[],values:[]}));
describe("captured UID assignment (mock persistence; no hardware or attendance)",()=>{
  it("confirms captured provenance, locks UID+student+device, assigns locked and records actor/history",async()=>{
    expect(await assignCapturedUid({} as any,2,3,"aabbccdd")).toMatchObject({cardId:6,uid:"AABBCCDD",studentId:3,status:"locked"});
    expect(state.queries.join("\n")).toContain("FOR UPDATE");
    expect(state.queries.join("\n")).toContain("FOR SHARE OF d");
    expect(state.queries.join("\n")).toContain("pg_advisory_xact_lock");
    expect(state.queries.join("\n")).toContain("INSERT INTO nfc_card_history");
    expect(state.values.some(v=>v.includes(7))).toBe(true);
    expect(state.queries.at(-1)).toBe("COMMIT");
    expect(state.queries.join("\n")).not.toMatch(/attendance_events|communication_/);
  });
  it.each(["captured","device","student","active"] as const)("rejects missing %s without card writes",async key=>{
    state[key]=false;await expect(assignCapturedUid({} as any,2,3,"AABBCCDD")).rejects.toBeInstanceOf(Error);
    expect(state.queries.at(-1)).toBe("ROLLBACK");
    expect(state.queries.some(q=>q.includes("INSERT INTO nfc_cards"))).toBe(false);
  });
  it.each(["reserved","prior"] as const)("rejects %s UID/student state",async key=>{
    state[key]=true;await expect(assignCapturedUid({} as any,2,3,"AABBCCDD")).rejects.toMatchObject({statusCode:409});
    expect(state.queries.some(q=>q.includes("INSERT INTO nfc_cards"))).toBe(false);
  });
  it.each(["invented","NFC-id-12","EID1.opaque","AABBCC","AABBCCDD00"])("rejects malformed UID %s",uid=>{
    expect(()=>capturedUid(uid)).toThrow();
  });
});
