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

router.get(
  "/cards/:cardId/printable",
  requireAuthentication(),
  async (req, res, next) => {
    try {
      const cardId = positiveInteger(req.params.cardId, "cardId");
      const schoolId = positiveInteger(req.query.schoolId, "schoolId");
      assertPlatformOwner(req);

      const result = await pool.query(printableCardSnapshotSql, [cardId, schoolId]);
      const snapshot = result.rows[0] as PrintableSnapshot | undefined;
      if (!snapshot) throw new AuthError(404, "NFC card not found in this school");

      const identity = resolvePrintableIdentity(snapshot);
      const schoolIdFromSnapshot = Number(snapshot.schoolId);
      const personId = identity.personType === "Student"
        ? Number(snapshot.studentId)
        : Number(snapshot.employeeId);
      const [schoolLogo, personPhoto] = await Promise.all([
        loadPrintableSchoolLogo(schoolIdFromSnapshot, snapshot.schoolLogo),
        loadPrintablePhoto(
          schoolIdFromSnapshot,
          personId,
          identity.photoPath,
          identity.personType === "Student" ? "student" : "employee",
        ),
      ]);

      const pdf = await buildNfcPrintablePdf({
        cardId: Number(snapshot.cardId),
        schoolName: snapshot.schoolName,
        schoolRegistrationNumber: snapshot.schoolRegistrationNumber,
        schoolAddress: snapshot.schoolAddress,
        schoolCity: snapshot.schoolCity,
        schoolState: snapshot.schoolState,
        schoolPhone: snapshot.schoolPhone,
        schoolEmail: snapshot.schoolEmail,
        personType: identity.personType,
        personName: identity.personName,
        permanentNumber: identity.permanentNumber,
        schoolLogo,
        personPhoto,
      });
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