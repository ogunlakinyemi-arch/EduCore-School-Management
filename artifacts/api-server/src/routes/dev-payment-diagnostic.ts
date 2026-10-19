import { getAuth } from "@clerk/express";
import { Router } from "express";
import { pool } from "@workspace/db";
import { DiagnosticError } from "../lib/development-payment-binding";
import { localPaymentDiagnostic } from "../services/local-payment-diagnostic";

const router = Router();
router.get("/dev/payment-diagnostic", async (req,res): Promise<void> => {
  res.set("Cache-Control","no-store");
  try {
    res.json(await localPaymentDiagnostic(pool,getAuth(req).userId,req.query));
  } catch (error) {
    res.status(error instanceof DiagnosticError ? error.status : 503).json({
      error:error instanceof DiagnosticError ? error.code : "LOCAL_PAYMENT_DIAGNOSTIC_UNAVAILABLE",
    });
  }
});
export default router;
