import express, { Router } from "express";
import { pool } from "@workspace/db";
import { readCardVerificationToken } from "../lib/id-card-verification";
import { printableCardSnapshotSql, resolvePrintableIdentity } from "../lib/nfc-printable-snapshot";

export const idCardVerificationRouter=Router();
// Public and read-only. Never return person, school, UID or device identifiers.
idCardVerificationRouter.post("/v1/id-cards/verify",express.json({limit:"2kb"}),async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const invalid={valid:false,message:"This card verification is invalid, revoked or no longer current."};
  try {
    const identity=readCardVerificationToken(req.body?.token);
    if(!identity) {res.json(invalid);return;}
    const snapshot=(await pool.query(printableCardSnapshotSql,[identity.cardId,identity.schoolId])).rows[0];
    if(!snapshot || snapshot.studentId!==identity.studentId ||
      (snapshot.studentId==null ? snapshot.employeeId : null)!==identity.employeeId) {res.json(invalid);return;}
    try { resolvePrintableIdentity(snapshot,"preview"); } catch {res.json(invalid);return;}
    res.json({valid:true,message:"Current EduCore-issued card identity. This does not grant NFC access, prove the holder's identity or record attendance."});
  } catch {res.status(503).json({valid:false,message:"Verification is temporarily unavailable. No access permission has been granted."});}
});
