import { createHash } from "node:crypto";
import { AuthError } from "../middlewares/auth";
import { parseXlsx, extractReadablePdf } from "../routes/people-import-service";

export type Component = {key:string;label:string;typeId:number;maxScore:number;assessmentId?:number};
export function uploadBytes(body:any) {
  const filename=typeof body.filename==="string"?body.filename.trim():"";
  if(!filename||filename.length>180||/[/\\\r\n\x00]/.test(filename)) throw new AuthError(400,"A safe filename is required");
  if(typeof body.dataBase64!=="string"||body.dataBase64.length>7*1024*1024||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(body.dataBase64)) throw new AuthError(400,"Upload a file of at most 5 MB");
  const buffer=Buffer.from(body.dataBase64,"base64");
  if(!buffer.length||buffer.length>5*1024*1024) throw new AuthError(400,"Upload a file of at most 5 MB");
  return {filename,buffer,digest:createHash("sha256").update(buffer).digest("hex")};
}
export function numericScore(value:unknown,max:number) {
  if(value===null||value===undefined||value==="") return null;
  if((typeof value!=="number"&&typeof value!=="string")||
    (typeof value==="string"&&!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))) throw new AuthError(400,"Scores must be numeric, with at most two decimal places");
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>max||Math.abs(n*100-Math.round(n*100))>1e-6) throw new AuthError(400,`Score must be between 0 and ${max}`);
  return n;
}
const normalize=(s:string)=>s.trim().toLowerCase().replace(/\s+/g," ");
export function previewResultImport(buffer:Buffer,filename:string,components:Component[],roster:any[]) {
  let source:{sourceRow:number;values:Record<string,string>}[]=[];
  let uncertain=false;
  try {
    if(/\.xlsx$/i.test(filename)&&buffer.subarray(0,2).toString()==="PK") source=parseXlsx(buffer);
    else if(/\.pdf$/i.test(filename)&&buffer.subarray(0,5).toString()==="%PDF-") {
      const lines=extractReadablePdf(buffer).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      const header=lines.find(line=>/\bstudent id\b/i.test(line)&&components.every(c=>normalize(line).includes(normalize(c.label))));
      if(!header) throw Error("PDF must have an unambiguous Student ID, Student Name and component header. Use the Excel template or manual entry.");
      for(const [index,line] of lines.entries()) {
        if(line===header||!(/^\d+\s/.test(line))) continue;
        const id=line.match(/^(\d+)\s+/)![1];
        const student=roster.find(s=>Number(s.studentId??s.id)===Number(id));
        if(!student) { source.push({sourceRow:index+1,values:{"Student ID":id,"Student Name":"","__uncertain":"Unknown or out-of-class student"}}); continue; }
        const name=student.studentName??`${student.firstName} ${student.lastName}`;
        const expected=new RegExp(`^${id}\\s+${name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+")}\\s+(.+)$`,"i");
        const tail=line.match(expected)?.[1]?.trim().split(/\s+/);
        if(!tail||tail.length!==components.length||tail.some(s=>!/^\d+(?:\.\d{1,2})?$/.test(s))) {
          source.push({sourceRow:index+1,values:{"Student ID":id,"Student Name":name,"__uncertain":"Uncertain PDF cells; no scores inferred"}});
        } else source.push({sourceRow:index+1,values:{"Student ID":id,"Student Name":name,...Object.fromEntries(components.map((c,i)=>[c.label,tail[i]]))}});
      }
      if(!source.length) throw Error("No reliable PDF rows were detected. Use Excel or manual entry.");
    } else throw Error("Supported result imports are XLSX and text-based PDF only.");
  } catch(error) {
    return {rows:[],validCount:0,invalidCount:0,missingStudents:roster.length,uncertain:true,message:error instanceof Error?error.message:"Could not safely extract this file"};
  }
  const headers=source[0]?Object.keys(source[0].values):[];
  const field=(row:Record<string,string>,label:string)=>Object.entries(row).find(([k])=>normalize(k)===normalize(label))?.[1]??"";
  const missingHeaders=components.filter(c=>!headers.some(h=>normalize(h)===normalize(c.label)));
  const seen=new Set<number>();
  const rows=source.map(row=>{
    const issues:string[]=[];
    const rawId=field(row.values,"Student ID");
    const admission=field(row.values,"Admission No");
    const candidates=roster.filter(s=>rawId?String(s.studentId??s.id)===rawId:admission&&String(s.admissionNo)===admission);
    const student=candidates.length===1?candidates[0]:undefined;
    if(!student) issues.push("Student not found in the authorized class/section roster (or identity is ambiguous)");
    const studentId=student?Number(student.studentId??student.id):null;
    const studentName=student?(student.studentName??`${student.firstName} ${student.lastName}`):field(row.values,"Student Name");
    if(studentId!==null) {
      if(seen.has(studentId)) issues.push("Duplicate student row");
      seen.add(studentId);
      if(admission&&admission!==String(student.admissionNo)) issues.push("Student ID and admission number do not match");
      if(normalize(field(row.values,"Student Name"))!==normalize(studentName)) issues.push("Student name does not match the roster");
    }
    if(row.values.__uncertain) {issues.push(row.values.__uncertain);uncertain=true;}
    for(const c of missingHeaders) issues.push(`Missing component column: ${c.label}`);
    const scores:Record<string,number|null>={};
    for(const c of components) {
      try {
        const score=numericScore(field(row.values,c.label),c.maxScore);
        scores[c.key]=score;
        if(score===null) issues.push(`Missing score: ${c.label}`);
      } catch(error) {issues.push(`${c.label}: ${(error as Error).message}`);scores[c.key]=null;}
    }
    return {sourceRow:row.sourceRow,studentId,studentName,scores,status:issues.length?"INVALID":"VALID",issues};
  });
  // Both occurrences of a duplicate must be invalid, not only the last.
  for(const row of rows) if(row.studentId!==null&&rows.filter(r=>r.studentId===row.studentId).length>1&&!row.issues.includes("Duplicate student row")) {
    row.issues.push("Duplicate student row");row.status="INVALID";
  }
  return {rows,validCount:rows.filter(r=>r.status==="VALID").length,invalidCount:rows.filter(r=>r.status==="INVALID").length,
    missingStudents:roster.length-seen.size,uncertain,message:uncertain?"Uncertain PDF rows must be corrected; no scores were guessed.":""};
}
