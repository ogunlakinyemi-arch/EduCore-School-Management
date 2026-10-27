import { Router } from "express";
import { pool } from "@workspace/db";
import { AuthError,getUserContext,requireAuthentication } from "../middlewares/auth";
import { readStudentPlatformAccess } from "../services/student-platform-access";
const router=Router();
router.get("/student/platform-subscription-access",requireAuthentication(),async(req,res,next)=>{
  res.setHeader("Cache-Control","no-store");
  try{
    const c=getUserContext(req);
    if(c.user.status!=="ACTIVE" || !c.roles.some(r=>r.role==="STUDENT" && r.status==="ACTIVE"))
      throw new AuthError(403,"Active Student access required.");
    res.json(await readStudentPlatformAccess(pool,c.user.id));
  }catch(error){next(error);}
});
export default router;
