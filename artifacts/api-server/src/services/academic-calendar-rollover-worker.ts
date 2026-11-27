import {rolloverSchoolCalendar,CalendarRolloverUnavailable,type CalendarPool} from "./academic-calendar-rollover";
type Logger={warn:(fields:object,message:string)=>void};
/** No provider, billing, roster promotion or entitlement adapter is imported. */
export function createCalendarRolloverTick(pool:CalendarPool,logger:Logger){
 let running=false;
 return async()=>{
  if(running)return;
  running=true;
  try{
   const c=await pool.connect();let schools:number[];
   try{schools=(await c.query("SELECT id FROM schools WHERE upper(status)='ACTIVE' ORDER BY id")).rows.map(s=>Number(s.id));}
   finally{c.release();}
   for(const id of schools){
    try{const result=await rolloverSchoolCalendar(pool,id);
     if(result.status==="BLOCKED")logger.warn({schoolId:id},"Academic rollover blocked; inspect retained calendar audit");
    }catch(error){
     const code=(error as {code?:unknown})?.code;
     logger.warn({schoolId:id,reason:error instanceof CalendarRolloverUnavailable?error.message:"TRANSACTION_RETRY_REQUIRED",
      sqlstate:typeof code==="string"&&/^[0-9A-Z]{5}$/.test(code)?code:undefined},
      "Academic rollover unavailable; school was not activated");
    }
   }
  }finally{running=false;}
 };
}
