import {classifyDatabaseError} from "@workspace/db";
type Pool={connect:()=>Promise<{
  query:(sql:string,values?:any[])=>Promise<{rows:any[]}>;
  release:(error?:boolean)=>void;
}>;totalCount?:number;idleCount?:number;waitingCount?:number};
/** Read-only, bounded shared-pool probe. Never replays writes or changes pool settings. */
export async function databaseReadiness(pool:Pool){
  const started=Date.now();
  let client:Awaited<ReturnType<Pool["connect"]>>|undefined;
  let transaction=false;
  try{
    client=await pool.connect();
    const acquisitionMs=Date.now()-started;
    await client.query("BEGIN READ ONLY");
    transaction=true;
    await client.query("SET LOCAL statement_timeout='2000ms'");
    const result=await client.query("SELECT 1 AS ready");
    if(Number(result.rows[0]?.ready)!==1)throw new Error("Readiness result unavailable");
    await client.query("ROLLBACK");transaction=false;
    return{ready:true,acquisitionMs,elapsedMs:Date.now()-started};
  }catch(error){
    return{ready:false,category:classifyDatabaseError(error).category,elapsedMs:Date.now()-started};
  }finally{
    if(client){
      let broken=false;
      if(transaction)try{await client.query("ROLLBACK");}catch{broken=true;}
      client.release(broken||undefined);
    }
  }
}
