import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  AuthError,
  getUserContext,
  requireAuthentication,
} from "../middlewares/auth";
import {
  PrintableUnsupportedIdentityError,
  printableCardSnapshotSql,
  resolvePrintableIdentity,
  type PrintableSnapshot,
} from "../lib/nfc-printable-snapshot";
import { loadPrintablePhoto, loadPrintableSchoolLogo } from "../lib/nfc-printable-images";
import { buildNfcPrintablePdf } from "../lib/nfc-printable-pdf";
import { rasterOfficialCard } from "../lib/nfc-card-preview";

const router = Router();

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new AuthError(400, `${label} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 2147483647) throw new AuthError(400, `${label} must be a positive integer within the supported range`);
  return parsed;
}

function assertPlatformOwner(req: Request) {
  const context = getUserContext(req);
  if (!context.roles.some((role) =>
    role.role === "PLATFORM_OWNER" && role.schoolId === null && role.status === "ACTIVE"
  )) {
    throw new AuthError(403, "Platform Owner access is required to print NFC cards");
  }
}

function printableError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof PrintableUnsupportedIdentityError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  if (error instanceof AuthError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.eventType });
  }
  return next(error);
}

async function renderCurrentCard(cardId: number, schoolId: number) {
  const result = await pool.query(printableCardSnapshotSql, [cardId, schoolId]);
  const snapshot = result.rows[0] as PrintableSnapshot | undefined;
  if (!snapshot) throw new AuthError(404, "NFC card not found in this school");
  const identity = resolvePrintableIdentity(snapshot);
  const personId = identity.personType === "Student" ? Number(snapshot.studentId) : Number(snapshot.employeeId);
  const [schoolLogo,personPhoto] = await Promise.all([
    loadPrintableSchoolLogo(schoolId,snapshot.schoolLogo),
    loadPrintablePhoto(schoolId,personId,identity.photoPath,identity.personType === "Student" ? "student" : "employee"),
  ]);
  return buildNfcPrintablePdf({cardId,schoolName:snapshot.schoolName,
    schoolRegistrationNumber:snapshot.schoolRegistrationNumber,schoolAddress:snapshot.schoolAddress,
    schoolCity:snapshot.schoolCity,schoolState:snapshot.schoolState,schoolPhone:snapshot.schoolPhone,
    schoolEmail:snapshot.schoolEmail,personType:identity.personType,personName:identity.personName,
    permanentNumber:identity.permanentNumber,schoolLogo,personPhoto});
}

router.get("/cards/:cardId/preview",requireAuthentication(),async(req,res,next)=>{
  try {
    const cardId=positiveInteger(req.params.cardId,"cardId");
    const schoolId=positiveInteger(req.query.schoolId,"schoolId");
    const context=getUserContext(req);
    const owner=context.roles.some(r=>r.role==="PLATFORM_OWNER" && r.schoolId===null && r.status==="ACTIVE");
    const admin=context.roles.some(r=>r.role==="SCHOOL_ADMIN" && r.schoolId===schoolId && r.status==="ACTIVE");
    if(!owner && !admin) throw new AuthError(403,"Only the Platform Owner or this school's Admin may view official card previews");
    const pdf=await renderCurrentCard(cardId,schoolId);
    res.setHeader("Cache-Control","private, no-store");
    res.json(await rasterOfficialCard(pdf));
  } catch(error) {
    if(error instanceof AuthError || error instanceof PrintableUnsupportedIdentityError) return printableError(error,res,next);
    req.log?.error({err:error},"Official card preview failed");
    return res.status(503).json({error:"Official card preview is unavailable; please retry"});
  }
});

router.get(
  "/cards/:cardId/printable",
  requireAuthentication(),
  async (req, res, next) => {
    try {
      const cardId = positiveInteger(req.params.cardId, "cardId");
      const schoolId = positiveInteger(req.query.schoolId, "schoolId");
      assertPlatformOwner(req);

      const pdf = await renderCurrentCard(cardId,schoolId);
      res.status(200);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="NFC-id-${cardId}.pdf"`);
      res.setHeader("Content-Length", String(pdf.length));
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(pdf);
    } catch (error) {
      return printableError(error, res, next);
    }
  },
);

export default router;