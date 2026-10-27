import { Router } from "express";
import { pool } from "@workspace/db";
import { PreviewStudentNfcReconciliationQueryParams } from "@workspace/api-zod";
import { getUserContext, isPlatformOwner, requireAuthentication } from "../middlewares/auth";
import { previewStudentNfcReconciliation, ReconciliationPreviewError } from "../services/student-nfc-reconciliation";

const router=Router();
router.use(requireAuthentication());
router.get("/owner/finance/student-nfc-reconciliation",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  try {
    const actor=getUserContext(req);
    if(!isPlatformOwner(actor) || actor.user.status!=="ACTIVE" || !actor.roles.some(r=>
      r.role==="PLATFORM_OWNER" && r.schoolId===null && r.status==="ACTIVE")) {
      res.status(403).json({error:"Active Platform Owner required."}); return;
    }
    const parsed=PreviewStudentNfcReconciliationQueryParams.safeParse(req.query);
    if(!parsed.success) { res.status(400).json({error:"A valid school and academic term are required."}); return; }
    res.json(await previewStudentNfcReconciliation(pool,parsed.data));
  } catch(error) {
    if(error instanceof ReconciliationPreviewError) { res.status(error.statusCode).json({error:error.message}); return; }
    req.log?.error({errorName:error instanceof Error?error.name:"Unknown"},"Read-only NFC reconciliation preview unavailable");
    res.status(503).json({error:"Reconciliation evidence could not be read safely. No records were changed."});
  }
});
export default router;
