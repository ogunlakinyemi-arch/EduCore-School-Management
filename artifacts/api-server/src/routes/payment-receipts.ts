import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "@workspace/db";
import { getUserContext, requireAuthentication } from "../middlewares/auth";
import { HostedPaymentError } from "../lib/hosted-manual-policy";
import { hostedError } from "./hosted-manual-payments";
import { hostedTransaction } from "../services/hosted-payment-store";
import { auditReceipt, receiptDownloadPath, receiptTarget, requireReceiptAccess } from "../services/payment-receipts";
import { privateReceiptStorage, RECEIPT_MAX_BYTES, receiptDigest, validateReceiptBytes } from "../services/payment-receipt-storage";

const body = z.object({ kind:z.enum(["PARENT_BANK_TRANSFER","SCHOOL_SETTLEMENT"]),
  invoiceId:z.number().int().positive().optional(),orderReference:z.string().regex(/^HCM1_[TL]_[a-f0-9]{32}$/).optional(),
  amountMinor:z.number().int().min(1).max(2147483647),purpose:z.string().trim().min(3).max(300),
  transferDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v),
  transferCompleted:z.boolean().optional() }).strict();
const id = z.string().uuid();
export const paymentReceiptsRouter = Router();
paymentReceiptsRouter.use(requireAuthentication(),(_req,res,next)=>{res.setHeader("Cache-Control","private, no-store");next();});
paymentReceiptsRouter.post("/",async(req,res)=>{
  try {
    const input=body.parse(req.body),ctx=getUserContext(req);
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos"}).format(new Date());
    if(input.transferDate>today) throw new HostedPaymentError(400,"FUTURE_TRANSFER","Transfer date cannot be in the future.");
    const receipt=await hostedTransaction(pool,async c=>{
      const target=await receiptTarget(c,ctx,input),receiptId=randomUUID();
      const r=await c.query(`INSERT INTO payment_receipt_uploads
        (id,kind,target_id,school_id,student_id,term_id,amount_minor,purpose,transfer_date,uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [receiptId,input.kind,target.targetId,target.schoolId,target.studentId,target.termId,input.amountMinor,input.purpose,input.transferDate,ctx.user.id]);
      await auditReceipt(c,ctx,r.rows[0],"Receipt upload requested");
      return r.rows[0];
    });
    res.status(201).json({id:receipt.id,uploadPath:`/api/payment-receipts/${receipt.id}/content`});
  }catch(e){hostedError(res,e);}
});
paymentReceiptsRouter.put("/:id/content",async(req,res,next)=>{
  try {
    const receiptId=id.parse(req.params.id),ctx=getUserContext(req);
    await hostedTransaction(pool,async c=>{
      const r=await c.query(`SELECT * FROM payment_receipt_uploads WHERE id=$1`,[receiptId]),row=r.rows[0];
      if(!row || Number(row.uploaded_by)!==ctx.user.id) throw new HostedPaymentError(404,"NOT_FOUND","Receipt not found.");
      await requireReceiptAccess(c,ctx,row);
    });
    next();
  } catch(e) { hostedError(res,e); }
},express.raw({type:()=>true,limit:RECEIPT_MAX_BYTES}),async(req,res)=>{
  try {
    const receiptId=id.parse(req.params.id),ctx=getUserContext(req);
    if(!Buffer.isBuffer(req.body)) throw new HostedPaymentError(400,"INVALID_RECEIPT","Send raw receipt bytes.");
    const validated=await validateReceiptBytes(req.body,(req.get("content-type")??"").split(";")[0]);
    const result=await hostedTransaction(pool,async c=>{
      const r=await c.query(`SELECT * FROM payment_receipt_uploads WHERE id=$1 FOR UPDATE`,[receiptId]),row=r.rows[0];
      if(!row || Number(row.uploaded_by)!==ctx.user.id) throw new HostedPaymentError(404,"NOT_FOUND","Receipt not found.");
      await requireReceiptAccess(c,ctx,row);
      if(row.state==="AVAILABLE"){
        if(row.sha256!==validated.sha256) throw new HostedPaymentError(409,"RECEIPT_IMMUTABLE","An uploaded receipt cannot be replaced.");
        return row;
      }
      // Serialize same-target/same-file uploads; never create a second financial submission.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${row.kind}:${row.target_id}:${validated.sha256}`]);
      const duplicate=await c.query(`SELECT * FROM payment_receipt_uploads WHERE kind=$1 AND target_id=$2
        AND sha256=$3 AND state='AVAILABLE'`,[row.kind,row.target_id,validated.sha256]);
      if(duplicate.rows[0]){
        if(Number(duplicate.rows[0].uploaded_by)!==ctx.user.id) throw new HostedPaymentError(409,"DUPLICATE_RECEIPT","This receipt has already been submitted for the target.");
        if(Number(duplicate.rows[0].amount_minor)!==Number(row.amount_minor) ||
          String(duplicate.rows[0].transfer_date)!==String(row.transfer_date)) {
          throw new HostedPaymentError(409,"DUPLICATE_RECEIPT_METADATA","This file already has a different declared amount or transfer date; review the original submission.");
        }
        await c.query(`UPDATE payment_receipt_uploads SET state='DUPLICATE',canonical_receipt_id=$2 WHERE id=$1`,[receiptId,duplicate.rows[0].id]);
        await auditReceipt(c,ctx,row,"Duplicate receipt upload reused",{canonicalReceiptId:duplicate.rows[0].id});
        return {...duplicate.rows[0],request_id:receiptId};
      }
      const objectPath=await privateReceiptStorage.save(receiptId,validated.bytes,validated.contentType);
      const saved=await c.query(`UPDATE payment_receipt_uploads SET state='AVAILABLE',object_path=$2,content_type=$3,
        size_bytes=$4,sha256=$5,uploaded_at=now() WHERE id=$1 RETURNING *`,
      [receiptId,objectPath,validated.contentType,validated.bytes.length,validated.sha256]);
      await auditReceipt(c,ctx,saved.rows[0],"Private receipt uploaded",{sha256:validated.sha256,sizeBytes:validated.bytes.length});
      return saved.rows[0];
    });
    res.json({id:result.request_id??result.id,canonicalReceiptId:result.id,sha256:result.sha256,
      downloadPath:receiptDownloadPath(result.id),uploadedAt:result.uploaded_at});
  }catch(e){hostedError(res,e);}
});
paymentReceiptsRouter.get("/:id/download",async(req,res)=>{
  try{
    const receiptId=id.parse(req.params.id),ctx=getUserContext(req);
    const r=await hostedTransaction(pool,async c=>{
      const found=await c.query(`SELECT * FROM payment_receipt_uploads WHERE id=$1 AND state='AVAILABLE'`,[receiptId]);
      const row=found.rows[0];
      if(!row) throw new HostedPaymentError(404,"NOT_FOUND","Receipt not found.");
      await requireReceiptAccess(c,ctx,row);
      const bytes=await privateReceiptStorage.read(receiptId);
      if(bytes.length!==Number(row.size_bytes)||receiptDigest(bytes)!==row.sha256) throw new HostedPaymentError(503,"RECEIPT_INTEGRITY_ERROR","Receipt integrity could not be verified.");
      await auditReceipt(c,ctx,row,"Private receipt downloaded");
      return {row,bytes};
    });
    const extension=r.row.content_type==="application/pdf"?"pdf":r.row.content_type==="image/png"?"png":"jpg";
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Content-Security-Policy","default-src 'none'; sandbox");
    res.setHeader("Content-Disposition",`attachment; filename="payment-receipt-${receiptId}.${extension}"`);
    res.type(r.row.content_type).send(r.bytes);
  }catch(e){hostedError(res,e);}
});
