// Synthetic catalog only. Actual SQL semantics are covered by the isolated native runner.
import {financialGuardBodies,financialGuardTriggers} from "../services/financial-guard-schema";
export function financialGuardCatalogFixture(){
  const functions=Object.entries(financialGuardBodies).map(([proname,prosrc],i)=>({
    oid:i+100,proname,prosrc:String(prosrc),prosecdef:false,provolatile:"v",proisstrict:false,
    proleakproof:false,proconfig:null,prokind:"f",pronargs:0,proparallel:"u",proretset:false,
    returns_trigger:true,lanname:"plpgsql",
  }));
  const triggers=financialGuardTriggers.map(t=>({
    tgname:t.name,relname:t.table,proname:t.fn,function_schema:"public",
    function_oid:functions.find(f=>f.proname===t.fn)!.oid,tgenabled:"O",
    tgtype:t.type,tgnargs:0,unconditional:true,unconstrained:true,columns:"",tgparentid:0,
  }));
  return{functions,triggers};
}
