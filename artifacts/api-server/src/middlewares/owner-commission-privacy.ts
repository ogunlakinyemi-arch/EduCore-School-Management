import { Router } from "express";
import { getUserContext, requireAuthentication } from "./auth";

const isActiveOwner = (context: ReturnType<typeof getUserContext>) =>
  context.user.status === "ACTIVE" && context.roles.some(role =>
    role.role === "PLATFORM_OWNER" && role.status === "ACTIVE" && role.schoolId === null);

/** Project responses at the HTTP boundary; never modify financial source rows. */
export function withoutBroFinancialData(input: unknown): unknown {
  if (Array.isArray(input)) return input
    .filter(value => {
      if (!value || typeof value !== "object") return true;
      const row = value as Record<string, unknown>;
      return !["PARTNER", "BRO"].includes(String(row.recipientType ?? row.recipient_type ?? "").toUpperCase());
    }).map(withoutBroFinancialData);
  if (!input || typeof input !== "object" || input instanceof Date) return input;
  return Object.fromEntries(Object.entries(input).filter(([key]) =>
    !/(commission|entitlement|partner(?:share|allocat|amount|revenue|expense|fee)|bro(?:share|amount))/i.test(key.replace(/[_-]/g, "")))
    .map(([key, value]) => [key, withoutBroFinancialData(value)]));
}

const router = Router();
// A BRO profile, even its administrator, is not a Platform Owner membership.
router.use([
  "/partner/commissions", "/partner/deferred-commissions", "/partner/payouts",
  "/partner/payout-information", "/partner/staff-nfc/commissions",
], requireAuthentication(), (req, res) => {
  const context = getUserContext(req);
  if (!isActiveOwner(context)) {
    res.setHeader("Cache-Control", "private, no-store");
    res.status(404).json({ error: "Resource not found" });
    return;
  }
  // Owners use their Owner-only financial routes, not a BRO self-service identity.
  res.status(404).json({ error: "Resource not found" });
});

router.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    let owner = false;
    try {
      const context = getUserContext(req);
      owner = isActiveOwner(context);
    } catch { /* Anonymous responses never receive private financial details. */ }
    // Only the separately authorized, allowlisted own-entitlement handler may
    // expose BRO earnings. PARTNER role alone never bypasses general redaction.
    const ownEntitlements = req.method === "GET" && req.path === "/partner/commission-entitlements"
      && res.locals.ownBroEntitlements === true;
    return json(owner || ownEntitlements ? body : withoutBroFinancialData(body));
  }) as typeof res.json;
  next();
});
export default router;
