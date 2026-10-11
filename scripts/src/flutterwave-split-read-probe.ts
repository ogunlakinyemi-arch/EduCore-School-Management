/** Genuine TEST read-only probe; never creates recipients or initiates money movement. */
import { splitProvider } from "../../artifacts/api-server/src/services/flutterwave-split-provider";
import { pool } from "@workspace/db";
import fs from "node:fs/promises";
try {
  const report = {
    observedAt:new Date().toISOString(),
    mode:"GENUINE TEST READS ONLY",
    evidence:await splitProvider().inspectReadEvidence(),
    recipientCreation:"NOT ATTEMPTED: authorized own-school/partner bank details and ownership review required",
    fixedSplitDisbursement:"NOT VERIFIED",
    actualBankSettlement:"NOT VERIFIED; TEST cannot prove real-money bank delivery",
  };
  console.log(JSON.stringify(report,null,2));
  await fs.mkdir(new URL("../../reports/flutterwave-splits/",import.meta.url),{recursive:true});
  await fs.writeFile(new URL("../../reports/flutterwave-splits/provider-read-investigation.json",import.meta.url),JSON.stringify(report,null,2));
} finally { await pool.end(); }
