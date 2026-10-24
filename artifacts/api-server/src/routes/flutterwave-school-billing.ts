import { Router } from "express";
import { z } from "zod";
import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { AuthError, getUserContext, requireAuthentication } from "../middlewares/auth";
import { readSchoolBillingContext } from "../services/flutterwave-school-billing";

export function createSchoolBillingContextRouter(deps:{
  pool:StudentSubscriptionSqlPool;env?:NodeJS.ProcessEnv;
}) {
  const router=Router();
  router.get("/flutterwave/live/billing-context",requireAuthentication(),async(req,res)=>{
    res.setHeader("Cache-Control","private, no-store");
    const input=z.object({schoolId:z.coerce.number().int().positive()}).strict().safeParse(req.query);
    if(!input.success){res.status(400).json({error:"Invalid school selection"});return;}
    try{res.json(await readSchoolBillingContext(deps.pool,
      {actorId:getUserContext(req).user.id,...input.data},deps.env));}
    catch(error){
      const denied=error instanceof AuthError&&error.statusCode===403;
      res.status(denied?403:503).json({error:denied?"Current school finance access is required":"Billing context unavailable"});
    }
  });
  return router;
}
