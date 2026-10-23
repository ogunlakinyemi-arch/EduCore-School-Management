import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

export const hash = value => createHash("sha256").update(value).digest("hex");
const functions = "'guard_flutterwave_live_intent','retain_flutterwave_live_history','guard_flutterwave_live_accrual','guard_live_workflow_state','hold_live_workflow'";
export class NativeRehearsal {
  constructor(directory, evidence, report) {
    this.directory=directory; this.evidence=evidence; this.report=report; this.counter=0;
    this.env={PATH:process.env.PATH,HOME:path.join(directory,"empty-home"),LANG:"C.UTF-8",LC_ALL:"C.UTF-8",
      PGPASSFILE:path.join(directory,"empty-pgpass"),PGSERVICEFILE:"/dev/null",PGSYSCONFDIR:directory};
    fs.mkdirSync(this.env.HOME,{mode:0o700});
    fs.writeFileSync(this.env.PGPASSFILE,"",{mode:0o600});
  }
  run(label, command, args, input, acceptedFailure=false) {
    const number=String(++this.counter).padStart(3,"0"), start=performance.now();
    const record={number,label,command,args,stdinSha256:input===undefined?null:hash(input),startedAt:new Date().toISOString()};
    let stdout="",stderr="",status=0;
    try { stdout=execFileSync(command,args,{cwd:process.cwd(),env:this.env,input,encoding:"utf8",maxBuffer:32*1024*1024,timeout:120000,stdio:["pipe","pipe","pipe"]}); }
    catch(error) { status=error.status??-1;stdout=String(error.stdout??"");stderr=String(error.stderr??error.message); }
    Object.assign(record,{status,durationMs:Math.round((performance.now()-start)*100)/100,
      stdoutFile:`${number}.stdout.log`,stderrFile:`${number}.stderr.log`});
    fs.writeFileSync(path.join(this.evidence,record.stdoutFile),stdout);
    fs.writeFileSync(path.join(this.evidence,record.stderrFile),stderr);
    if(input!==undefined) {
      record.stdinFile=`${number}.stdin.${command==="psql"?"sql":"txt"}`;
      fs.writeFileSync(path.join(this.evidence,record.stdinFile),input);
    }
    this.report.commands.push(record);
    if(status!==0&&!acceptedFailure)throw new Error(`${label} failed: ${stderr.slice(-1500)}`);
    return {stdout,stderr,status,record};
  }
  args(database) {
    assert.match(database,/^rehearsal_[a-z_]+$|^postgres$/);
    return ["-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose",
      "-h",this.directory,"-p","5432","-U","isolated_rehearsal","-d",database];
  }
  sql(database,text,label="query",failure) {
    const setup="SET lock_timeout='2s'; SET statement_timeout='60s'; SET application_name='rehearsal_sql';\n";
    const result=this.run(label,"psql",this.args(database),setup+text,!!failure);
    if(failure) {
      this.check(result.status!==0&&new RegExp(`ERROR:\\s+${failure}:`).test(result.stderr),
        label+" expected refusal",{expectedSqlstate:failure,actualStatus:result.status,error:result.stderr.trim()});
    }
    return result.stdout.trim();
  }
  json(database,text,label="catalog-query") { return JSON.parse(this.sql(database,text,label)); }
  check(value,label,details={}) {
    this.report.checks.push({label,status:value?"PASS":"FAIL",...details});
    assert.ok(value,label);
  }
  equal(actual,expected,label) { this.check(hash(JSON.stringify(actual))===hash(JSON.stringify(expected)),label,
    {actualSha256:hash(JSON.stringify(actual)),expectedSha256:hash(JSON.stringify(expected))}); }
  catalog(database,live=null) {
    const filter=alias=>live===null?"true":`(${alias}.relname LIKE 'flutterwave_live_%')=${live}`;
    const funcFilter=live===null?"true":`(p.proname IN (${functions}))=${live}`;
    return this.json(database,`SELECT jsonb_build_object(
      'tables',(SELECT coalesce(jsonb_agg(c.relname ORDER BY c.relname),'[]') FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND ${filter("c")}),
      'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'position',a.attnum,
        'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,
        'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum),'[]')
        FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND ${filter("c")}),
      'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,'kind',k.contype,
        'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid),
        'supportingIndex',(SELECT relname FROM pg_class WHERE oid=k.conindid)) ORDER BY c.relname,k.conname),'[]')
        FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relnamespace='public'::regnamespace AND ${filter("c")}),
      'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',i.relname,'valid',x.indisvalid,
        'ready',x.indisready,'definition',pg_get_indexdef(i.oid),
        'owningConstraint',(SELECT conname FROM pg_constraint WHERE conindid=i.oid AND contype IN ('p','u') LIMIT 1)) ORDER BY c.relname,i.relname),'[]')
        FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid WHERE c.relnamespace='public'::regnamespace AND ${filter("c")}),
      'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid)) ORDER BY p.proname),'[]')
        FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND ${funcFilter}),
      'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) ORDER BY c.relname,t.tgname),'[]')
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal AND ${filter("c")}),
      'sequences',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'start',s.seqstart,'increment',s.seqincrement,
        'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle) ORDER BY c.relname),'[]')
        FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid WHERE c.relnamespace='public'::regnamespace AND ${filter("c")})
      );`,"canonical-object-inventory");
  }
  data(database,live=null) {
    return this.json(database,`CREATE TEMP TABLE snapshot_rows(name text,n bigint,digest text);
      DO $snapshot$ DECLARE r record; BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public'
          ${live===null?"":`AND (tablename LIKE 'flutterwave_live_%')=${live}`} ORDER BY tablename LOOP
          EXECUTE format('INSERT INTO snapshot_rows SELECT %L,count(*),
            encode(sha256(convert_to(coalesce(string_agg(to_jsonb(x)::text,chr(10) ORDER BY to_jsonb(x)::text),''''),''UTF8'')),''hex'') FROM public.%I x',
            r.tablename,r.tablename);
        END LOOP;
      END $snapshot$;
      SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY name),'[]') FROM snapshot_rows s;`,"synthetic-row-fingerprints");
  }
  apply(database,sources,name,direction="up",failure) {
    const bytes=sources[name][direction];
    this.check(hash(bytes)===this.report.manifest.stages.find(s=>s.name===name)[`${direction}Sha256`],
      `pre-execution hash ${database} ${name}.${direction}`);
    this.sql(database,bytes,`${database}-${name}-${direction}`,failure);
  }
  async start({encoding}={}) {
    assert.ok(encoding===undefined||encoding==="UTF8");
    this.run("fresh-initdb","initdb",["-D",path.join(this.directory,"data"),"-U","isolated_rehearsal","-A","trust","--no-locale",
      ...(encoding?["--encoding",encoding]:[])]);
    const output=fs.openSync(path.join(this.evidence,"postgres.log"),"w",0o600);
    this.server=spawn("postgres",["-D",path.join(this.directory,"data"),"-k",this.directory,"-h","","-p","5432",
      "-c","unix_socket_permissions=0700","-c","log_lock_waits=on","-c","deadlock_timeout=100ms","-c","log_min_duration_statement=0"],
      {env:this.env,stdio:["ignore",output,output]});
    fs.closeSync(output);
    for(let n=0;n<100;n++) {
      if(fs.existsSync(path.join(this.directory,".s.PGSQL.5432")))break;
      if(this.server.exitCode!==null)throw new Error("Fresh PostgreSQL exited; no alternative target permitted");
      await new Promise(r=>setTimeout(r,50));
    }
    const target=this.json("postgres",`SELECT jsonb_build_object('dataDirectory',current_setting('data_directory'),
      'database',current_database(),'user',current_user,'tcpAddress',inet_server_addr(),'listenAddresses',current_setting('listen_addresses'),
      'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'version',version(),
      'startedAt',pg_postmaster_start_time(),'socketDirectories',current_setting('unix_socket_directories'));`,"prove-isolated-target");
    this.check(target.dataDirectory===path.join(this.directory,"data")&&target.tcpAddress===null&&target.listenAddresses===""
      &&target.user==="isolated_rehearsal"&&target.socketDirectories===this.directory,"new private Unix-socket cluster proven",target);
    this.check(Number(fs.readFileSync(path.join(this.directory,"data","postmaster.pid"),"utf8").split("\n")[0])===this.server.pid,
      "socket server is the child just initialized");
    this.report.target=target;
    const lockOutput=fs.openSync(path.join(this.evidence,"locks.log"),"w",0o600);
    this.monitor=spawn("psql",this.args("postgres"),{env:this.env,stdio:["pipe",lockOutput,lockOutput]});
    fs.closeSync(lockOutput);
    this.monitor.stdin.end(`SELECT jsonb_build_object('at',clock_timestamp(),'locks',coalesce(jsonb_agg(
      jsonb_build_object('database',a.datname,'pid',a.pid,'mode',l.mode,'granted',l.granted,'relationOid',l.relation,
      'application',a.application_name,'waitType',a.wait_event_type,'waitEvent',a.wait_event)) FILTER(WHERE a.pid IS NOT NULL),'[]'))
      FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid=l.pid AND a.application_name LIKE 'rehearsal%';\n\\watch 0.05\n`);
  }
  create(database) { this.sql("postgres",`CREATE DATABASE ${database};`,"create-fresh-"+database); }
  async lockReadiness(database,sources) {
    // Deparsing constraints/indexes can itself request relation locks. Inspect
    // before contention and after holder release, never while holding the lock.
    const before=this.catalog(database);
    const holder=spawn("psql",this.args(database),{env:this.env,stdio:["pipe","pipe","pipe"]});
    let out="",err="";
    holder.stdout.on("data",chunk=>{out+=chunk;});holder.stderr.on("data",chunk=>{err+=chunk;});
    holder.stdin.end("SET application_name='rehearsal_contention'; BEGIN; LOCK TABLE flutterwave_live_authority_reviews IN ACCESS EXCLUSIVE MODE; SELECT 'ISOLATED_LOCK_HELD'; SELECT pg_sleep(15); ROLLBACK;");
    try {
      for(let n=0;n<100&&!out.includes("ISOLATED_LOCK_HELD");n++) {
        if(holder.exitCode!==null)throw new Error("Cannot establish synthetic lock holder: "+err);
        await new Promise(r=>setTimeout(r,20));
      }
      this.check(out.includes("ISOLATED_LOCK_HELD"),"deliberate lock established on disposable table only");
      this.apply(database,sources,"readiness","up","55P03");
    } finally {
      // Let the bounded fixture finish its explicit ROLLBACK. Killing psql
      // alone can leave its backend inside pg_sleep, retaining the test lock.
      if(holder.exitCode===null&&holder.signalCode===null)await new Promise(resolve=>holder.once("exit",resolve));
      fs.writeFileSync(path.join(this.evidence,"lock-holder.log"),out+"\n"+err);
    }
    this.equal(this.catalog(database),before,"lock-timeout stage rolled back without catalog changes");
    this.check(this.json(database,`SELECT jsonb_build_object('n',count(*)) FROM pg_stat_activity WHERE application_name='rehearsal_contention';`,"lock-holder-released").n===0,
      "planned recovery inspected: synthetic holder gone before same-hash stage execution");
  }
  async close() {
    for(const child of [this.monitor,this.server]) {
      if(child&&child.exitCode===null)await new Promise(resolve=>{child.once("exit",resolve);child.kill("SIGTERM");});
    }
    this.report.clusterStopped=true;
    fs.rmSync(this.directory,{recursive:true,force:true});
    this.report.clusterDeleted=!fs.existsSync(this.directory);
  }
}
