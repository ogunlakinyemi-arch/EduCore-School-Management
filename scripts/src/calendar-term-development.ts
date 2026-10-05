import {pool} from '@workspace/db';
import {readFile,writeFile} from 'node:fs/promises';
import {validateAcademicPeriod} from '../../artifacts/api-server/src/lib/academic-period-validation';

const baselinePath='/tmp/calendar-term-preservation.json';
if(process.env.REPLIT_DEPLOYMENT||!process.env.REPLIT_DEV_DOMAIN)throw Error('Development only');
const identity=(await pool.query('SELECT current_database() AS db,inet_server_addr()::text AS address')).rows[0];
if(identity.db!=='heliumdb'||identity.address!==null)throw Error('Unverified local Development target');
const mode=process.argv[2];
try{
  if(mode==='capture'){
    try{await readFile(baselinePath);throw Error('Baseline exists; never overwrite');}catch(e:any){if(e.code!=='ENOENT')throw e;}
    const session=(await pool.query('SELECT id,school_id,name,start_date::text,end_date::text FROM academic_sessions WHERE id=358 AND school_id=1393')).rows[0];
    if(session?.name!=='2026/2027'||session.start_date!=='2026-09-14'||session.end_date!=='2027-07-23')throw Error('Current saved full-year session differs; stop rather than overwrite concurrent edits');
    const tables=(await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1")).rows;
    const baseline:Record<string,unknown[]>={};
    for(const {table_name} of tables){
      if(!/^[a-z_]+$/.test(table_name))throw Error('Unsafe table');
      baseline[table_name]=(await pool.query(`SELECT to_jsonb(t) AS row FROM "${table_name}" t`)).rows.map(r=>r.row);
    }
    await writeFile(baselinePath,JSON.stringify(baseline),{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({capturedTables:tables.length,session,firstTermId:20,existingSecondTermId:21,existingThirdTermId:38,sessionAndThirdAlreadySavedBySchoolAdmin:true}));
  }else if(mode==='native'){
    const cte=`WITH academic_sessions(id,school_id,start_date,end_date,status,is_current) AS
      (VALUES(358,1393,date '2026-09-14',date '2027-07-23','ACTIVE',true)),
      academic_terms(id,school_id,academic_session_id,start_date,end_date) AS
      (VALUES(20,1393,358,date '2026-09-14',date '2026-12-18'),(21,1393,358,date '2027-01-11',date '2027-04-16')) `;
    const client=await pool.connect();
    try{
      await client.query('BEGIN READ ONLY');
      const db={query:(sql:string,p?:unknown[])=>client.query(/FROM academic_(sessions|terms)/.test(sql)?cte+sql:sql,p)};
      const cases=[
        {label:'Second Term in 2027',startDate:'2027-01-11',endDate:'2027-04-16',current:{id:21},allowed:true},
        {label:'Third Term in 2027',startDate:'2027-04-19',endDate:'2027-07-23',current:{},allowed:true},
        {label:'A term crossing calendar years',startDate:'2026-12-20',endDate:'2027-01-04',current:{},allowed:true},
        {label:'Start outside session',startDate:'2026-09-13',endDate:'2026-09-14',current:{},allowed:false},
        {label:'End outside session',startDate:'2027-07-20',endDate:'2027-07-24',current:{},allowed:false},
        {label:'Reversed dates',startDate:'2027-07-23',endDate:'2027-04-19',current:{},allowed:false},
        {label:'Impossible date',startDate:'2027-02-30',endDate:'2027-03-10',current:{},allowed:false},
        {label:'Overlapping Second Term',startDate:'2027-04-10',endDate:'2027-07-23',current:{},allowed:false},
        {label:'Shared end/start day overlap',startDate:'2027-04-16',endDate:'2027-07-23',current:{},allowed:false},
      ];
      const results=[];
      for(const test of cases){
        let allowed=true;try{await validateAcademicPeriod(db,1393,{startDate:test.startDate,endDate:test.endDate},test.current,358);}catch{allowed=false;}
        if(allowed!==test.allowed)throw Error(`Native case failed: ${test.label}`);
        results.push({case:test.label,result:'PASS'});
      }
      await client.query('ROLLBACK');
      console.log(JSON.stringify({developmentOnly:true,readOnlyPostgresValidation:results}));
    }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
  }else if(mode==='verify'){
    const baseline=JSON.parse(await readFile(baselinePath,'utf8'));
    const session=(await pool.query('SELECT id,school_id,name,start_date::text,end_date::text FROM academic_sessions WHERE id=358 AND school_id=1393')).rows[0];
    if(session?.name!=='2026/2027'||session.start_date!=='2026-09-14'||session.end_date!=='2027-07-23')throw Error('Saved full-year session changed during verification');
    const changed:Record<string,number>={},appended:Record<string,number>={},bookkeeping:Record<string,number>={};
    const normalize=(table:string,row:any)=>{
      const copy={...row};
      if(table==='app_users'||table==='school_subscription_enforcement')delete copy.updated_at;
      return JSON.stringify(copy);
    };
    for(const [table,original] of Object.entries(baseline) as [string,any[]][]){
      if(!/^[a-z_]+$/.test(table))throw Error('Unsafe table');
      const actual=(await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t`)).rows.map(r=>r.row);
      const remaining=new Map<string,number>();
      actual.forEach(r=>{const key=normalize(table,r);remaining.set(key,(remaining.get(key)??0)+1);});
      for(const row of original){
        const key=normalize(table,row),count=remaining.get(key)??0;
        if(!count)changed[table]=(changed[table]??0)+1;else{
          remaining.set(key,count-1);
          if((table==='app_users'||table==='school_subscription_enforcement')&&actual.some(r=>normalize(table,r)===key&&r.updated_at!==row.updated_at))bookkeeping[table]=(bookkeeping[table]??0)+1;
        }
      }
      const extra=[...remaining.values()].reduce((a,b)=>a+b,0);if(extra)appended[table]=extra;
    }
    const terms=(await pool.query('SELECT id,name,start_date::text,end_date::text,status,is_current FROM academic_terms WHERE academic_session_id=358 AND school_id=1393 ORDER BY start_date')).rows;
    const report={originalBusinessRowsPreserved:!Object.keys(changed).length,allExistingSessionAndTermRowsUnchanged:!changed.academic_terms&&!changed.academic_sessions,session,terms,changed,appended,bookkeeping,agentCalendarDataWrites:0,excludedBookkeepingFields:['app_users.updated_at','school_subscription_enforcement.updated_at']};
    await writeFile('/tmp/calendar-term-preservation-result.json',JSON.stringify(report),{mode:0o600});
    console.log(JSON.stringify(report));
    if(Object.keys(changed).length)process.exitCode=1;
  }else throw Error('Use capture, native or verify');
}finally{await pool.end();}
