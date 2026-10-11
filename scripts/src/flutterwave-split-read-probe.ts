/** Genuine TEST read-only probe; never creates recipients or initiates money movement. */
import { splitProvider } from "../../artifacts/api-server/src/services/flutterwave-split-provider";
import { pool } from "@workspace/db";
try {
  console.log(JSON.stringify({
    mode:"GENUINE TEST READS ONLY",
    capabilities:await splitProvider().inspectReadCapabilities(),
    recipientCreation:"NOT ATTEMPTED: authorized own-school/partner bank details and ownership review required",
    fixedSplitDisbursement:"NOT VERIFIED",
    actualBankSettlement:"NOT VERIFIED; TEST cannot prove real-money bank delivery",
  },null,2));
} finally { await pool.end(); }
