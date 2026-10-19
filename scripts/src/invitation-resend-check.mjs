// Read-only Development schema capture; all fixtures/mutations stay under /tmp.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root=resolve(import.meta.dirname,"../.."),temp=mkdtempSync(join(tmpdir(),"educore-invite-check-"));
const socket=join(temp,"socket");mkdirSync(socket);
const run=(command,args,options={})=>{
  const r=spawnSync(command,args,{cwd:root,encoding:"utf8",maxBuffer:16*1024*1024,...options});
  if(r.status!==0)throw new Error(`${command} failed: ${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
try{
  if(!process.env.DATABASE_URL)throw new Error("Read-only Development schema connection required");
  writeFileSync(join(temp,"schema.sql"),run("pg_dump",["--dbname",process.env.DATABASE_URL,"--schema-only","--no-owner","--no-privileges"]));
  run("initdb",["-D",join(temp,"data"),"-A","trust","--no-locale","-U","postgres"]);
  run("pg_ctl",["-D",join(temp,"data"),"-l",join(temp,"server.log"),"-o",`-k ${socket} -p 55483 -c listen_addresses=''`,"-w","start"]);
  run("psql",["-h",socket,"-p","55483","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-f",join(temp,"schema.sql")]);
  process.stdout.write(run("pnpm",["--filter","@workspace/api-server","exec","vitest","run",
    "src/routes/invitation-resend.postgres.test.ts","--reporter=dot"],{
    env:{...process.env,INVITATION_TEST_SOCKET:socket},
  }));
}finally{
  spawnSync("pg_ctl",["-D",join(temp,"data"),"-m","immediate","-w","stop"],{stdio:"ignore"});
  rmSync(temp,{recursive:true,force:true});
}
