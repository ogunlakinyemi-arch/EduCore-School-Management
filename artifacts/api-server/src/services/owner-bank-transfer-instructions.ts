import {decryptPayrollBankValue} from "../lib/payroll-bank-encryption";
import {readStudentRollout} from "./student-platform-rollout";
import {officialOwnerAccountName, OWNER_RECEIVING_ACCOUNT_POLICY} from "../lib/owner-receiving-account-policy";
type Sql={query:(sql:string,values?:unknown[])=>Promise<{rows:any[]}>};

/** Read-only. Reuse the company's existing encrypted account, never a school,
 * personal payroll account, provider subaccount or historical fallback. */
export async function ownerBankTransferInstructions(db:Sql,
  scope:{schoolId:number;studentId:number;termId:number},actorId:number){
  const access=(await db.query(`SELECT s.name AS school_name,t.name AS term_name,
    EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id
      AND m.role='PLATFORM_OWNER' AND m.school_id IS NULL AND m.status='ACTIVE') AS "isOwner"
    FROM schools s JOIN students st ON st.school_id=s.id AND st.id=$2
    JOIN academic_terms t ON t.school_id=s.id AND t.id=$3
    JOIN app_users u ON u.id=$4 AND u.status='ACTIVE'
    WHERE s.id=$1 AND lower(s.status)='active' AND lower(st.status)='active'
      AND EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.status='ACTIVE'
        AND ((m.role='SCHOOL_ADMIN' AND m.school_id=s.id)
          OR (m.role='PLATFORM_OWNER' AND m.school_id IS NULL)))`,
    [scope.schoolId,scope.studentId,scope.termId,actorId])).rows[0];
  if(!access)return null;
  const rollout=await readStudentRollout(db,scope.schoolId,scope.termId);
  const base={amountMinor:320000,currency:"NGN",schoolName:String(access.school_name),
    termName:String(access.term_name),transferReference:`YETENIA-S${scope.schoolId}-T${scope.termId}-ST${scope.studentId}`,
    collectionPeriodEligible:rollout.chargeable,ownerConfigurationPath:access.isOwner===true?"/payment-settlement":null};
  const unavailable=()=>({...base,available:false,bank:null,
    message:"Verified Owner receiving details for optional ₦3,200/student/term subscription assistance are unavailable. Do not transfer funds; contact the Platform Owner. The Owner must explicitly verify the saved receiving account in Company Profile. Flutterwave merchant settlement configuration is separate."});
  const {rows}=await db.query(`SELECT business_name,currency,verification_status,verified_at,verified_by,
    bank_name_encrypted,account_name_encrypted,account_number_encrypted,account_last4,encryption_key_version
    ,EXISTS(SELECT 1 FROM settlement_payroll_audit_events a
      WHERE a.scope='PLATFORM' AND a.school_id IS NULL AND a.record_type='SETTLEMENT_PROFILE'
        AND a.record_id=p.id AND a.actor_user_id=p.verified_by AND a.actor_role='PLATFORM_OWNER'
        AND a.action='FLUTTERWAVE_BANK_ACCOUNT_RESOLVED' AND a.new_status='VERIFIED'
        AND a.occurred_at=p.verified_at
        AND a.metadata->>'receivingAccountPolicy'=$1
        AND a.metadata->>'resolutionEnvironment'='LIVE') AS receiving_policy_verified
    FROM settlement_payroll_profiles p WHERE scope='YEMAIT_COMPANY' AND school_id IS NULL LIMIT 2`,
    [OWNER_RECEIVING_ACCOUNT_POLICY]);
  if(rows.length!==1)return unavailable();
  const row=rows[0],verifiedAt=new Date(row.verified_at??"").getTime();
  if(row.receiving_policy_verified!==true||row.verification_status!=="VERIFIED"||row.currency!=="NGN"||
    !Number.isFinite(verifiedAt)||verifiedAt>Date.now()||
    !Number.isSafeInteger(Number(row.verified_by))||Number(row.verified_by)<=0||
    !officialOwnerAccountName(row.business_name))return unavailable();
  try{
    const read=(field:string)=>decryptPayrollBankValue(row[`${field}_encrypted`],
      row.encryption_key_version,`settlement:yemait-company:${field.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase())}`);
    const bankName=read("bank_name"),accountName=read("account_name"),accountNumber=read("account_number");
    if(typeof bankName!=="string"||bankName.trim().length<2||
      !officialOwnerAccountName(accountName)||
      typeof accountNumber!=="string"||!/^[0-9]{10}$/.test(accountNumber)||
      accountNumber.slice(-4)!==row.account_last4)return unavailable();
    return {...base,available:true,bank:{businessName:row.business_name,bankName,accountName,accountNumber},
      message:"These are verified Owner receiving account instructions for optional assistance only. Cash and bank transfers never activate NFC or pay the subscription, even after receipt is confirmed. The Owner must initiate a separate authorized Flutterwave checkout; only its successful, independently server-verified transaction can establish this student's term entitlement. Flutterwave merchant settlement is separate."};
  }catch{return unavailable();}
}
