import {Router,type Request} from "express";
import {z} from "zod";
import {pool} from "@workspace/db";
import type {OwnerAttendanceReport} from "@workspace/api-zod";
import {AuthError,getUserContext,requireAuthentication} from "../middlewares/auth";
import {ownerAttendanceFilters,ownerAttendanceSql,ownerAttendanceRow,ownerAttendanceCsv} from "../services/owner-attendance";
import {exportCsvCell} from "./platform-workspace";
const router=Router();
function owner(req:Request){
  const ctx=getUserContext(req);
  if(!ctx.roles.some(r=>r.role==="PLATFORM_OWNER"&&r.status==="ACTIVE"))throw new AuthError(403,"Platform Owner only");
  return ctx;
}
const run=(fn:(req:Request,res:any)=>Promise<void>)=>(req:Request,res:any,next:any)=>{
  void fn(req,res).catch(e=>e instanceof z.ZodError?res.status(400).json({error:e.issues.map(i=>i.message).join("; ")}):next(e));
};
async function school(id:number){
  const row=(await pool.query("SELECT id,name FROM schools WHERE id=$1",[id])).rows[0];
  if(!row)throw new AuthError(404,"School not found");
  return row;
}
async function audit(req:Request,schoolId:number,event:string,metadata:unknown){
  const ctx=owner(req);
  await pool.query(`INSERT INTO audit_logs(school_id,actor_user_id,"user",role,action,module,event_type,result,metadata)
    VALUES($1,$2,$3,'PLATFORM_OWNER','Read-only school attendance monitoring','Attendance',$4,'SUCCESS',$5::jsonb)`,
    [schoolId,ctx.user.id,ctx.user.email,event,JSON.stringify(metadata)]);
}
router.get("/platform/attendance/classes",requireAuthentication(),run(async(req,res)=>{
  owner(req);const {schoolId}=z.object({schoolId:z.coerce.number().int().positive()}).strict().parse(req.query);
  await school(schoolId);
  const classes=(await pool.query("SELECT id,name FROM school_classes WHERE school_id=$1 ORDER BY name,id",[schoolId])).rows;
  await audit(req,schoolId,"OWNER_ATTENDANCE_CLASSES_VIEWED",{count:classes.length});
  res.set("Cache-Control","no-store").json(classes);
}));
router.get("/platform/attendance/records",requireAuthentication(),run(async(req,res)=>{
  owner(req);const q=ownerAttendanceFilters.parse(req.query),selectedSchool=await school(q.schoolId);
  let selectedClass=null;
  if(q.type==="STUDENT"){
    selectedClass=(await pool.query("SELECT id,name FROM school_classes WHERE id=$1 AND school_id=$2",[q.classId,q.schoolId])).rows[0];
    if(!selectedClass)throw new AuthError(404,"Class not found in this school");
  }
  const csv=q.format==="CSV",limit=csv?5001:q.pageSize,offset=csv?0:(q.page-1)*q.pageSize;
  const raw=(await pool.query(ownerAttendanceSql(q.type),[q.schoolId,q.from,q.to,q.classId??null,limit,offset])).rows;
  // Keep totals accurate for a now-empty page without silently exporting a subset.
  let total=Number(raw[0]?.total??0);
  if(!raw.length&&offset>0){
    const first=(await pool.query(ownerAttendanceSql(q.type),[q.schoolId,q.from,q.to,q.classId??null,1,0])).rows;
    total=Number(first[0]?.total??0);
  }
  if(csv&&total>5000)throw new AuthError(409,"More than 5000 rows. Narrow the date range before exporting.");
  const report:OwnerAttendanceReport={school:selectedSchool,type:q.type,class:selectedClass,from:q.from,to:q.to,
    timeZone:"Africa/Lagos",generatedAt:new Date().toISOString(),page:csv?1:q.page,pageSize:csv?limit:q.pageSize,total,
    rows:raw.map(r=>ownerAttendanceRow(r,q.type))};
  await audit(req,q.schoolId,csv?"OWNER_ATTENDANCE_EXPORTED":"OWNER_ATTENDANCE_VIEWED",
    {...q,total,returned:report.rows.length});
  res.set("Cache-Control","no-store");
  if(csv)res.set("Content-Disposition",`attachment; filename="school-${q.schoolId}-${q.type.toLowerCase()}-attendance-${q.from}-${q.to}.csv"`)
    .type("text/csv").send(ownerAttendanceCsv(report,exportCsvCell));
  else res.json(report);
}));
// No domain mutations are implemented, including for dual-role Owners.
router.use("/platform/attendance",requireAuthentication(),run(async(req)=>{
  owner(req);throw new AuthError(403,"Attendance monitoring is read-only");
}));
export default router;
