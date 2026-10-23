import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { hash } from "./native.mjs";
export function scanProvenance(r,root) {
  r.env.GIT_NO_LAZY_FETCH="1";
  const target="eda974665826aa4d5affc07f24f658122ac81502a7190313f0edcd99d24206ba";
  const refs=r.run("provenance-refs","git",["for-each-ref","--format=%(refname) %(objectname)"]).stdout.trim().split("\n");
  const objects=r.run("provenance-SQL-object-inventory","git",["rev-list","--objects","--all","--reflog"]).stdout.trim().split("\n");
  const candidates=objects.map(line=>{const space=line.indexOf(" ");return {oid:line.slice(0,space),path:line.slice(space+1)};})
    .filter(o=>/^[0-9a-f]{40}$/.test(o.oid)&&o.path.endsWith(".sql"));
  const reachableCandidateCount=new Set(candidates.map(c=>c.oid)).size;
  const integrity=r.run("provenance-object-integrity","git",["fsck","--full","--unreachable"],undefined,true);
  if(integrity.status!==0)throw new Error("Git integrity could not be established; no provenance success claim");
  const orphanTrees=[...new Set([...integrity.stdout.matchAll(/^unreachable tree ([0-9a-f]{40})$/gm)].map(m=>m[1]))];
  for(const tree of orphanTrees) {
    const entries=r.run("provenance-unreachable-SQL-paths-"+tree,"git",["ls-tree","-r","-z",tree]).stdout.split("\0").filter(Boolean);
    for(const entry of entries) {
      const match=/^(\d+) blob ([0-9a-f]{40})\t([\s\S]+)$/.exec(entry);
      if(match&&match[3].endsWith(".sql"))candidates.push({oid:match[2],path:match[3],unreachableTree:tree});
    }
  }
  const unique=[...new Map(candidates.map(o=>[o.oid,o])).values()];
  const inventory=[];
  // Raw bytes through git's batch protocol; no decoding, newline conversion,
  // source reconstruction, credential files, remote fetch or ledger access.
  const input=unique.map(o=>o.oid).join("\n")+"\n";
  const bytes=execFileSync("git",["cat-file","--batch"],{cwd:root,env:{...r.env,GIT_NO_LAZY_FETCH:"1"},input,maxBuffer:64*1024*1024});
  r.report.gitBatch={command:"git",args:["cat-file","--batch"],stdinSha256:hash(input),
    stdoutSha256:hash(bytes),stdoutBytes:bytes.length,scope:"SQL-path blobs only; raw bytes fingerprinted, contents not emitted"};
  let offset=0;
  for(const object of unique) {
    const end=bytes.indexOf(10,offset),header=bytes.subarray(offset,end).toString("ascii").split(" ");
    if(header[1]!=="blob")throw new Error("Unreadable/nonblob SQL candidate: "+object.oid);
    const size=Number(header[2]);if(!Number.isSafeInteger(size)||size<0)throw new Error("Invalid Git object size");
    const data=bytes.subarray(end+1,end+1+size);
    if(data.length!==size||bytes[end+1+size]!==10)throw new Error("Truncated Git batch");
    inventory.push({...object,bytes:size,sha256:hash(data)});offset=end+size+2;
  }
  const current="lib/db/drizzle/0004_platform_operations.sql";
  const pathHistory=r.run("provenance-associated-path-history","git",["log","--all","--reflog","--format=%H %aI","--",current]).stdout;
  return {target,refs,scope:"Locally available SQL-path blobs from all refs/reflogs and every fsck-reported unreachable tree; raw bytes, no network/ledger.",
    reachableCandidateCount,unreachableTreeCount:orphanTrees.length,
    candidateCount:inventory.length,unreadableCandidates:0,matches:inventory.filter(o=>o.sha256===target),inventory,
    currentPath:current,currentSha256:hash(fs.readFileSync(path.join(root,current))),pathHistory,
    objectIntegrity:{status:integrity.status,stdout:integrity.stdout,stderr:integrity.stderr},
    originalSourceRecovered:inventory.some(o=>o.sha256===target),ledgerQueried:false,ledgerModified:false,
    limit:"No claim about unavailable executor/remote/archive artifacts or blobs with no known SQL path; hash/text association is not execution evidence."};
}
