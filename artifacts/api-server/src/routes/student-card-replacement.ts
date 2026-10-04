import { Router } from "express";
import {
  RequestCardReplacementBody, IssueCardReplacementBody, VerifyCardReplacementPaymentBody,
} from "@workspace/api-zod";
import { z } from "zod";
import { requireAuthentication, AuthError, handleAuthError } from "../middlewares/auth";
import { listReplacements, requestReplacement, issueReplacement, verifyReplacementPayment } from "../services/student-card-replacement";

const router = Router();
router.use(requireAuthentication());
const id = z.coerce.number().int().positive();
router.get("/card-replacements", async (req,res) => {
  try {
    res.json(await listReplacements(req,req.query.schoolId == null ? undefined : id.parse(req.query.schoolId)));
  } catch (error) { respond(error,req,res); }
});
router.post("/card-replacements", async (req,res) => {
  try {
    const input = RequestCardReplacementBody.parse(req.body);
    res.json(await requestReplacement(req,input.cardId,input.reason.trim()));
  } catch (error) { respond(error,req,res); }
});
router.post("/card-replacements/:requestId/issue", async (req,res) => {
  try {
    const input = IssueCardReplacementBody.parse(req.body);
    res.json(await issueReplacement(req,id.parse(req.params.requestId),input.uid.trim()));
  } catch (error) { respond(error,req,res); }
});
router.post("/card-replacements/:requestId/verify", async (req,res) => {
  try {
    const input = VerifyCardReplacementPaymentBody.parse(req.body);
    res.json(await verifyReplacementPayment(req,id.parse(req.params.requestId),input.providerTransactionId));
  } catch (error) { respond(error,req,res); }
});
function respond(error: unknown, req: any, res: any) {
  if (error instanceof AuthError) { handleAuthError(error,req,res); return; }
  if (error && typeof error === "object" && "issues" in error) { res.status(400).json({error:"Invalid replacement request"}); return; }
  req.log?.error({err:error},"Card replacement failed");
  res.status(503).json({error:"Card replacement is unavailable; refresh before retrying"});
}
export default router;