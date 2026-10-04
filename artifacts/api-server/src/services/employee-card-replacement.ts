import {getUserContext,AuthError} from "../middlewares/auth";
import type {Request} from "express";
type Sql={query:(sql:string,values?:any[])=>Promise<{rows:any[]}>};

/** Caller owns the replacement/invoice locks, payment gate and transaction. */
export async function issueEmployeeReplacement(db:Sql,req:Request,r:any,uid:string) {
  const employees=await db.query("SELECT id FROM employees WHERE id=$1 AND school_id=$2 AND UPPER(employment_status)='ACTIVE' FOR UPDATE",[r.employee_id,r.school_id]);
  if(!employees.rows.length) throw new AuthError(409,"Employee is no longer active in this school");
  const previous=await db.query(`SELECT c.*,b.id binding_id,b.employee_id,b.status binding_status
    FROM nfc_cards c JOIN employee_nfc_card_bindings b ON b.nfc_card_id=c.id AND b.school_id=c.school_id
    WHERE c.id=$1 AND c.school_id=$2 FOR UPDATE OF c,b`,[r.old_card_id,r.school_id]);
  const old=previous.rows[0];
  if(!old||old.employee_id!==r.employee_id||old.student_id!=null||old.replaced_by_card_id!=null||
    !["lost","blocked","inactive","suspended"].includes(old.status)) throw new AuthError(409,"Old employee card identity or revocation state changed");
  await db.query("SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))",[uid]);
  const target=(await db.query("SELECT * FROM nfc_cards WHERE lower(uid)=lower($1) FOR UPDATE",[uid])).rows[0];
  if(!target||target.school_id!==r.school_id||target.student_id!=null||target.status!=="unassigned"||target.id===old.id) throw new AuthError(409,"Select a different prepared unassigned UID from this school");
  const used=await db.query(`SELECT 1 FROM nfc_card_history WHERE nfc_card_id=$1 AND student_id IS NOT NULL
    UNION ALL SELECT 1 FROM employee_nfc_card_bindings WHERE nfc_card_id=$1
    UNION ALL SELECT 1 FROM employee_nfc_card_bindings WHERE school_id=$2 AND employee_id=$3
      AND id<>$4 AND status IN ('ASSIGNED','ACTIVE','LOCKED') LIMIT 1`,
    [target.id,r.school_id,r.employee_id,old.binding_id]);
  if(used.rows.length) throw new AuthError(409,"UID has person history or the employee already has another current binding");
  const actor=getUserContext(req).user.id;
  await db.query(`UPDATE employee_nfc_card_bindings SET status='REPLACED',updated_at=NOW() WHERE id=$1 AND school_id=$2`,[old.binding_id,r.school_id]);
  const binding=(await db.query(`INSERT INTO employee_nfc_card_bindings(school_id,nfc_card_id,employee_id,status,created_by_user_id)
    VALUES($1,$2,$3,'ACTIVE',$4) RETURNING id`,[r.school_id,target.id,r.employee_id,actor])).rows[0];
  await db.query(`UPDATE nfc_cards SET status='active',issued_at=NOW(),activated_at=NOW() WHERE id=$1 AND school_id=$2`,[target.id,r.school_id]);
  await db.query(`UPDATE nfc_cards SET status='replaced',replaced_at=NOW(),replaced_by_card_id=$1,
    replaced_by_school_id=$2,deactivated_at=COALESCE(deactivated_at,NOW()) WHERE id=$3`,[target.id,r.school_id,old.id]);
  await db.query(`INSERT INTO employee_nfc_card_history
    (school_id,binding_id,nfc_card_id,employee_id,action,previous_status,new_status,replacement_nfc_card_id,reason,actor_user_id)
    VALUES($1,$2,$3,$4,'REPLACED',$5,'REPLACED',$6,$7,$8),
          ($1,$9,$6,$4,'ASSIGNED_AS_REPLACEMENT','UNASSIGNED','ACTIVE',NULL,$7,$8)`,
    [r.school_id,old.binding_id,old.id,r.employee_id,old.binding_status,target.id,`Replacement request ${r.id}`,actor,binding.id]);
  await db.query(`UPDATE student_nfc_replacement_requests SET status='ISSUED',new_card_id=$1,issued_by=$2,issued_at=NOW() WHERE id=$3`,[target.id,actor,r.id]);
}