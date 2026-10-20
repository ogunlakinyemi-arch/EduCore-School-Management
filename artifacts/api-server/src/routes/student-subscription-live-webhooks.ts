import { Router, type IRouter } from "express";
import { configuredLiveStudentSubscriptionAdapter } from "../lib/fee-providers/factory";

/**
 * Separate LIVE ingress, deliberately without a financial resolver or database.
 * Never return 2xx for an event we cannot durably process in this release.
 */
export const studentSubscriptionLiveWebhookRouter: IRouter = Router();
studentSubscriptionLiveWebhookRouter.post("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!Buffer.isBuffer(req.body) || req.body.length === 0 || req.body.length > 65_536) {
    res.status(400).json({ error: "Webhook body is invalid" });
    return;
  }
  const adapter = configuredLiveStudentSubscriptionAdapter();
  if (!adapter) {
    res.status(503).json({ error: "Flutterwave LIVE configuration is disabled, missing or mismatched" });
    return;
  }
  try {
    adapter.authenticateWebhook(req.headers);
  } catch {
    res.status(401).json({ error: "Flutterwave LIVE webhook authentication failed" });
    return;
  }
  res.status(503).json({
    error: "Flutterwave LIVE processing remains blocked pending merchant evidence and release review",
    processed: false,
  });
});
