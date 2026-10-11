/**
 * Advance NFC requests are permitted for dated ACTIVE/PLANNED future terms
 * in the school's explicitly current ACTIVE session. A term in progress must
 * still be explicitly current and ACTIVE. Historical/undated periods fail closed.
 * SQL aliases are deliberately fixed, never supplied by the browser.
 */
export const nfcPayableTermPredicate = `
  ses.is_current=true AND UPPER(ses.status)='ACTIVE'
  AND ses.start_date<=CURRENT_DATE AND ses.end_date>=CURRENT_DATE
  AND t.start_date>=ses.start_date AND t.end_date<=ses.end_date
  AND t.end_date>=t.start_date AND t.end_date>=CURRENT_DATE
  AND UPPER(t.status) IN ('ACTIVE','PLANNED')
  AND (t.start_date>CURRENT_DATE
    OR (t.is_current=true AND UPPER(t.status)='ACTIVE'))`;
