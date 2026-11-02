import type { Request } from "express";
import { pool } from "@workspace/db";
import { AuthError, assertRoles, getUserContext } from "../middlewares/auth";

export type CardDetachInput = {
  schoolId: number; personId: number; personType: "STUDENT" | "TEACHER" | "STAFF"; reason: string;
};

/** Explicit non-loss unlink. No inventory/history deletion, billing or activation. */
export async function detachOwnerCard(req: Request, cardId: number, input: CardDetachInput) {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const db = await pool.connect();
  const actor = getUserContext(req).user.id;
  try {
    await db.query("BEGIN");
    // Match employee assignment's employee -> physical-card lock order.
    if (input.personType !== "STUDENT") {
      const employee = await db.query(`SELECT id FROM employees WHERE id=$1 AND school_id=$2
        AND employee_type=$3 FOR UPDATE`, [input.personId, input.schoolId, input.personType]);
      if (!employee.rows[0]) throw new AuthError(404, "Selected employee not found");
    }
    const card = (await db.query(`SELECT id,school_id,student_id,uid,status,replaced_by_card_id
      FROM nfc_cards WHERE id=$1 AND school_id=$2 FOR UPDATE`, [cardId, input.schoolId])).rows[0];
    if (!card) throw new AuthError(404, "Card not found in the selected school");
    if (card.replaced_by_card_id != null || !["active", "locked"].includes(String(card.status).toLowerCase()))
      throw new AuthError(409, "Only a currently linked, non-retired card can be detached");
    const binding = (await db.query(`SELECT id,employee_id,status FROM employee_nfc_card_bindings
      WHERE nfc_card_id=$1 AND school_id=$2 FOR UPDATE`, [cardId, input.schoolId])).rows[0];
    if (input.personType === "STUDENT") {
      if (Number(card.student_id) !== input.personId || binding)
        throw new AuthError(409, "This is no longer the selected student's current card");
      await db.query(`INSERT INTO nfc_card_history
        (school_id,nfc_card_id,student_id,action,previous_status,new_status,reason,actor_user_id)
        VALUES($1,$2,$3,'UNLINKED',$4,'unassigned',$5,$6)`,
      [input.schoolId, cardId, input.personId, card.status, input.reason, actor]);
    } else {
      if (card.student_id != null || !binding || Number(binding.employee_id) !== input.personId ||
          !["ASSIGNED", "ACTIVE", "LOCKED"].includes(binding.status))
        throw new AuthError(409, "This is no longer the selected employee's current card");
      // Existing binding enum uses DEACTIVATED for non-current bindings. The
      // physical card itself becomes unassigned, not inactive/lost/damaged.
      await db.query(`UPDATE employee_nfc_card_bindings SET status='DEACTIVATED',updated_at=NOW()
        WHERE id=$1 AND school_id=$2`, [binding.id, input.schoolId]);
      await db.query(`INSERT INTO employee_nfc_card_history
        (school_id,binding_id,nfc_card_id,employee_id,action,previous_status,new_status,reason,actor_user_id)
        VALUES($1,$2,$3,$4,'UNLINKED',$5,'DEACTIVATED',$6,$7)`,
      [input.schoolId, binding.id, cardId, input.personId, binding.status, input.reason, actor]);
    }
    await db.query(`UPDATE nfc_cards SET student_id=NULL,status='unassigned' WHERE id=$1 AND school_id=$2`, [cardId, input.schoolId]);
    await db.query(`INSERT INTO audit_logs("user",role,actor_user_id,school_id,action,module,record_id,event_type,result,metadata)
      VALUES('Platform Owner','PLATFORM_OWNER',$1,$2,'Owner detached linked card','Cards',$3,
        'OWNER_CARD_DETACHED','SUCCESS',$4::jsonb)`,
    [actor, input.schoolId, cardId, JSON.stringify({cardId,uid:card.uid,personId:input.personId,personType:input.personType,
      bindingId:binding?.id ?? null,reason:input.reason,previousStatus:card.status,newStatus:"unassigned",confirmed:true})]);
    await db.query("COMMIT");
    return {cardId,schoolId:input.schoolId,uid:card.uid,status:"unassigned",detached:true};
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally {db.release();}
}

/** One mutable binding per physical employee card is an existing schema rule.
 * Preserve all append-only per-person history; reuse ONLY an explicitly detached
 * binding, never a lost, replaced or merely deactivated employee card. */
export const reusableEmployeeBindingSql = `INSERT INTO employee_nfc_card_bindings(school_id,nfc_card_id,employee_id,status,created_by_user_id)
  VALUES($1,$2,$3,'ASSIGNED',$4)
  ON CONFLICT (nfc_card_id) DO UPDATE SET employee_id=EXCLUDED.employee_id,status='ASSIGNED',updated_at=NOW()
  WHERE employee_nfc_card_bindings.school_id=EXCLUDED.school_id
    AND employee_nfc_card_bindings.status='DEACTIVATED'
    AND (SELECT h.action FROM employee_nfc_card_history h
      WHERE h.binding_id=employee_nfc_card_bindings.id AND h.school_id=EXCLUDED.school_id
      ORDER BY h.id DESC LIMIT 1)='UNLINKED'
  RETURNING id`;
