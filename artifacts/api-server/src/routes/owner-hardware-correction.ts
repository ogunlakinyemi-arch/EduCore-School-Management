import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { AuthError, assertRoles, getUserContext, requireAuthentication } from "../middlewares/auth";
import { previewHardwareCorrection, applyHardwareCorrection } from "../services/owner-hardware-correction";
import { ApplyOwnerHardwareCorrectionBody } from "@workspace/api-zod";

const router = Router();
router.use(requireAuthentication());
const run = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => void fn(req, res).catch(next);
const path = "/platform/devices/owner-hardware-correction";
router.get(path, run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  res.set("Cache-Control", "no-store");
  res.json(await previewHardwareCorrection(pool, getUserContext(req).user.id));
}));
router.post(path, run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const parsed = ApplyOwnerHardwareCorrectionBody.strict().safeParse(req.body);
  if (!parsed.success) throw new AuthError(400, "Confirmation, current preflight fingerprint and reason required");
  res.set("Cache-Control", "no-store");
  res.json(await applyHardwareCorrection(pool, getUserContext(req).user.id, {
    ...parsed.data, confirm: true, reason: parsed.data.reason.trim(),
  }));
}));
export default router;
