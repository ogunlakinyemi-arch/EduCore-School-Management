import { Router } from "express";
import { z } from "zod";
import { GetLocalFlutterwaveSplitSimulationResponse, RunLocalFlutterwaveSplitSimulationBody } from "@workspace/api-zod";
import { assertRoles, requireAuthentication, AuthError } from "../middlewares/auth";
import { requireSplitDevelopment } from "../lib/flutterwave-split-policy";
import { buildLocalSplitSimulation, type LocalSplitSimulationInput } from "../lib/local-split-simulation";
import { LOCAL_SPLIT_SIMULATION_MODE, LOCAL_SPLIT_SIMULATION_PATH } from "../lib/local-split-simulation-barrier";

const router = Router();
const input = RunLocalFlutterwaveSplitSimulationBody.strict().superRefine((v,c) => {
  if (["REVIEW","ENABLE"].includes(v.action) && !v.acknowledgeFictional) {
    c.addIssue({code:"custom",message:"Acknowledge TEST / NOT REAL"});
  }
});
router.use(LOCAL_SPLIT_SIMULATION_PATH,requireAuthentication());
router.all(LOCAL_SPLIT_SIMULATION_PATH,(req,res,next) => {
  try {
    requireSplitDevelopment();
    const owner = assertRoles(req,["PLATFORM_OWNER"]);
    if (!owner.roles.some(r=>r.role==="PLATFORM_OWNER" && r.status==="ACTIVE" && r.schoolId===null)) {
      throw new AuthError(403,"Active Owner access is required");
    }
    if (!["GET","POST"].includes(req.method)) { res.status(405).json({error:"Simulation supports preview/actions only"}); return; }
    const data:LocalSplitSimulationInput = req.method === "GET"
      ? {mode:LOCAL_SPLIT_SIMULATION_MODE,exampleSchoolId:1496 as const,action:"PREVIEW" as const,acknowledgeFictional:false}
      : input.parse(req.body);
    res.set("Cache-Control","no-store").json(GetLocalFlutterwaveSplitSimulationResponse.parse(buildLocalSplitSimulation(data)));
  } catch(error) {
    if (error instanceof z.ZodError) { res.status(400).json({error:"Invalid TEST / NOT REAL simulation action"}); return; }
    next(error);
  }
});
export default router;
