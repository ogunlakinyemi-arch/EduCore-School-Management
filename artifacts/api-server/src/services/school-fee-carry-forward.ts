/** A balance projection, never another invoice/debt/payment allocation. The
 * existing explicit invoice/line selection remains the accounting authority. */
export type SchoolFeeBalance={id:number;academicTermId:number;dueDate:string;
 outstandingMinor:number;paidMinor:number;status:string};
export function schoolFeeCarryForward<T extends SchoolFeeBalance>(invoices:T[],currentTermId:number|null,today:string){
 const original=invoices.filter(i=>!["CANCELLED","VOIDED","WAIVED"].includes(i.status.toUpperCase()))
  .sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id-b.id);
 const open=original.filter(i=>Number.isSafeInteger(i.outstandingMinor)&&i.outstandingMinor>0);
 return {invoices:original,
  outstandingMinor:open.reduce((sum,i)=>sum+i.outstandingMinor,0),
  arrearsMinor:currentTermId===null?null:open.filter(i=>i.academicTermId!==currentTermId&&i.dueDate<=today)
    .reduce((sum,i)=>sum+i.outstandingMinor,0),
  overdueMinor:open.filter(i=>i.dueDate<today).reduce((sum,i)=>sum+i.outstandingMinor,0)};
}
/** Original school's published source only; legacy platform bindings are not
 * school-published charges, irrespective of the numeric price or display name. */
export function publishedSchoolInvoiceSql(alias="i"){
 if(!/^[a-z_][a-z0-9_]*$/i.test(alias))throw Error("Invalid invoice alias");
 return `EXISTS(SELECT 1 FROM fee_structures published_fee
  WHERE published_fee.id=${alias}.structure_id AND published_fee.school_id=${alias}.school_id
   AND published_fee.status IN ('PUBLISHED','ARCHIVED') AND published_fee.published_by IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM student_subscription_terms legacy_nfc
   WHERE legacy_nfc.school_id=${alias}.school_id AND legacy_nfc.legacy_invoice_id=${alias}.id)`;
}
/** A profile's default school is not the authority for every linked child.
 * Require the recipient's live Parent membership in the invoice's own school.
 * Do not join the child's current school: transfers never move old invoices. */
export function linkedGuardianInvoiceSql(alias="i"){
 if(!/^[a-z_][a-z0-9_]*$/i.test(alias))throw Error("Invalid invoice alias");
 return `EXISTS(SELECT 1 FROM parents fee_guardian
  JOIN parent_student_relationships fee_link ON fee_link.parent_id=fee_guardian.id
  JOIN school_memberships fee_guardian_role ON fee_guardian_role.user_id=fee_guardian.user_id
   AND fee_guardian_role.school_id=${alias}.school_id AND fee_guardian_role.role='PARENT'
   AND upper(fee_guardian_role.status)='ACTIVE'
  WHERE fee_guardian.user_id=$1 AND upper(fee_guardian.status)='ACTIVE'
   AND fee_link.student_id=${alias}.student_id AND upper(fee_link.status)='ACTIVE')`;
}
/** Preserve the separately authorized existing replacement-card payment flow.
 * This exception does not publish a platform subscription or put replacement
 * requests into ordinary-fee arrears/reminder selection. Callers must still
 * enforce the live parent/child or student ownership predicate. */
export function familyPayableInvoiceSql(alias="i"){
 const published=publishedSchoolInvoiceSql(alias);
 return `((${published}) OR EXISTS(SELECT 1 FROM student_nfc_replacement_requests card_replacement
  WHERE card_replacement.invoice_id=${alias}.id AND card_replacement.school_id=${alias}.school_id
   AND card_replacement.student_id=${alias}.student_id))`;
}
