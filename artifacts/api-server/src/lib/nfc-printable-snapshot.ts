import { AuthError } from "../middlewares/auth";

export type PrintableSnapshot = {
  cardId: number;
  schoolId: number;
  cardStatus: string;
  studentId: number | null;
  studentStatus: string | null;
  studentName: string | null;
  admissionNo: string | null;
  studentPhoto: string | null;
  employeeBindingCount: number;
  employeeId: number | null;
  employeeType: string | null;
  employeeStatus: string | null;
  employeeName: string | null;
  employeeNo: string | null;
  employeePhoto: string | null;
  employeeBindingStatus: string | null;
  schoolName: string;
  schoolRegistrationNumber: string | null;
  schoolAddress: string | null;
  schoolCity: string | null;
  schoolState: string | null;
  schoolPhone: string | null;
  schoolEmail: string | null;
  schoolLogo: string | null;
};

export class PrintableUnsupportedIdentityError extends Error {
  readonly statusCode = 422;
}

/**
 * Take a printable identity snapshot from the card's present assignment only.
 * No history table or academic data participates in this read.
 */
export const printableCardSnapshotSql = `
  SELECT nc.id AS "cardId", nc.school_id AS "schoolId", nc.status AS "cardStatus",
         nc.student_id AS "studentId", st.status AS "studentStatus",
         CASE WHEN st.id IS NULL THEN NULL
              ELSE trim(concat_ws(' ',st.first_name,st.middle_name,st.last_name)) END AS "studentName",
         st.admission_no AS "admissionNo", st.photo AS "studentPhoto",
         COALESCE(emp."bindingCount",0)::int AS "employeeBindingCount",
         emp."employeeId", emp."employeeType", emp."employeeStatus",
         emp."employeeName", emp."employeeNo", emp."employeePhoto", emp."bindingStatus" AS "employeeBindingStatus",
         s.name AS "schoolName", s.registration_number AS "schoolRegistrationNumber",
         s.address AS "schoolAddress", s.city AS "schoolCity", s.state AS "schoolState",
         s.phone AS "schoolPhone", s.email AS "schoolEmail", logo.object_path AS "schoolLogo"
    FROM nfc_cards nc
    JOIN schools s ON s.id=nc.school_id
    LEFT JOIN students st ON st.id=nc.student_id AND st.school_id=nc.school_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS "bindingCount",
             (array_agg(e.id ORDER BY b.id DESC))[1] AS "employeeId",
             (array_agg(e.employee_type ORDER BY b.id DESC))[1] AS "employeeType",
             (array_agg(e.employment_status ORDER BY b.id DESC))[1] AS "employeeStatus",
             (array_agg(trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) ORDER BY b.id DESC))[1] AS "employeeName",
             (array_agg(e.employee_no ORDER BY b.id DESC))[1] AS "employeeNo",
             (array_agg(e.photo ORDER BY b.id DESC))[1] AS "employeePhoto",
             (array_agg(b.status ORDER BY b.id DESC))[1] AS "bindingStatus"
        FROM employee_nfc_card_bindings b
        JOIN employees e ON e.id=b.employee_id AND e.school_id=b.school_id
       WHERE b.nfc_card_id=nc.id AND b.school_id=nc.school_id
         AND b.status IN ('ASSIGNED','ACTIVE','LOCKED')
    ) emp ON TRUE
    LEFT JOIN school_branding_logos logo
      ON logo.school_id=s.id AND logo.is_current=true
   WHERE nc.id=$1 AND nc.school_id=$2
   LIMIT 1
`;

export function resolvePrintableIdentity(snapshot: PrintableSnapshot) {
  if (!snapshot) throw new AuthError(404, "NFC card not found in this school");
  if (snapshot.studentId !== null && snapshot.employeeBindingCount > 0) {
    throw new AuthError(409, "The NFC card has conflicting current assignments");
  }

  if (snapshot.studentId !== null) {
    if (!snapshot.studentName || !snapshot.admissionNo || !snapshot.studentStatus) {
      throw new AuthError(409, "The NFC card's current student assignment is invalid");
    }
    if (snapshot.studentStatus.toLowerCase() !== "active" ||
        snapshot.cardStatus.toLowerCase() !== "active") {
      throw new AuthError(409, "Only an active, currently assigned NFC card can be printed");
    }
    return {
      personType: "Student" as const,
      personName: snapshot.studentName,
      permanentNumber: snapshot.admissionNo,
      photoPath: snapshot.studentPhoto,
    };
  }

  if (snapshot.employeeBindingCount !== 1 || !snapshot.employeeId ||
      !snapshot.employeeType || !snapshot.employeeStatus ||
      !snapshot.employeeBindingStatus) {
    throw new AuthError(409, "The NFC card has no single current person assignment");
  }
  const employeeType = snapshot.employeeType.trim().toUpperCase();
  if (!["TEACHER","STAFF"].includes(employeeType)) {
    throw new PrintableUnsupportedIdentityError("Printable NFC cards support Teachers, Staff and Students only");
  }
  const bindingStatus = snapshot.employeeBindingStatus.toUpperCase();
  const cardStatus = snapshot.cardStatus.toLowerCase();
  const printableCurrentPair =
    (bindingStatus === "ASSIGNED" && cardStatus === "locked") ||
    (bindingStatus === "ACTIVE" && cardStatus === "active");
  if (snapshot.employeeStatus.toUpperCase() !== "ACTIVE" || !printableCurrentPair) {
    throw new AuthError(409, "Only an active, currently assigned NFC card can be printed");
  }
  if (!snapshot.employeeName || !snapshot.employeeNo) {
    throw new AuthError(409, "The current employee assignment is missing required identity data");
  }
  return {
    personType: (employeeType === "TEACHER" ? "Teacher" : "Staff") as "Teacher" | "Staff",
    personName: snapshot.employeeName,
    permanentNumber: snapshot.employeeNo,
    photoPath: snapshot.employeePhoto,
  };
}