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
      return !["PARTNER", "BRO", "PLATFORM", "PLATFORM_PROVIDER_FEE"].includes(String(row.recipientType ?? row.recipient_type ?? "").toUpperCase());
    }).map(withoutBroFinancialData);
  if (!input || typeof input !== "object" || input instanceof Date) return input;
  return Object.fromEntries(Object.entries(input).filter(([key]) =>
    !/(commission|entitlement|partner(?:share|allocat|amount|revenue|expense|fee|accrual)|bro(?:share|amount|accrual|earning|payout)|platform(?:share|allocat|revenue|expense|net|amount)|providerFee)/i.test(key.replace(/[_-]/g, "")))
    .map(([key, value]) => [key, withoutBroFinancialData(value)]));
}

const router = Router();
// A BRO profile, even its administrator, is not a Platform Owner membership.
const blockedBroRoutes = [
  "/partner/commissions", "/partner/deferred-commissions", "/partner/payouts",
  "/partner/payout-information", "/partner/staff-nfc/commissions",
];
router.use((req, res, next) => {
  // Exact exceptions only. The handlers independently enforce actual profile
  // ownership; this must not reopen commission feeds or arbitrary descendants.
  const bankAccountOperation =
    (req.method === "GET" && req.path === "/partner/payout-information")
    || (req.method === "PATCH" && req.path === "/partner/payout-information")
    || (req.method === "POST" && req.path === "/partner/payout-information/lookup-account");
  if (bankAccountOperation) { next(); return; }
  const path = req.path.toLowerCase();
  if (!blockedBroRoutes.some(root => path === root || path.startsWith(`${root}/`))) { next(); return; }
  requireAuthentication()(req, res, () => {
    const context = getUserContext(req);
    if (!isActiveOwner(context)) {
      res.setHeader("Cache-Control", "private, no-store");
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    // Owners use their Owner-only financial routes, not a BRO self-service identity.
    res.status(404).json({ error: "Resource not found" });
  });
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
    // This exact handler independently rereads database authority and projects
    // only the actual BRO owner's earnings; school users receive no BRO rows.
    const scopedCurrent=req.method==="GET"&&req.path==="/current-finance/overview"
      &&res.locals.scopedCurrentFinanceProjection===true;
    return json(owner || ownEntitlements || scopedCurrent ? body : withoutBroFinancialData(body));
  }) as typeof res.json;
  next();
});
export default router;
