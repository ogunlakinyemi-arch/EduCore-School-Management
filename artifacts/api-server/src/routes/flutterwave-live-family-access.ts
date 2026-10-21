import { Router, type IRouter } from "express";
import { z } from "zod";
import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { AuthError, getUserContext, requireAuthentication } from "../middlewares/auth";
import { assertLiveApplicationContext, releasedLiveApplicationContext, type LiveApplicationContext } from "../services/flutterwave-live-application";
import { readLiveFamilyAccess } from "../services/flutterwave-live-family-access";
import { LiveFinalizationBlocked } from "../lib/flutterwave-live-verification";
import { GetMyLiveSubscriptionAccessQueryParams, GetMySubscriptionEnforcementResponse } from "@workspace/api-zod";

const selection = GetMyLiveSubscriptionAccessQueryParams.strict();

/** Both paths use exactly the same identity/evidence contract. The normal /me
 * path continues legacy routing ONLY when no LIVE source was selected at all. */
export function createLiveFamilyAccessRouter(deps:{pool:StudentSubscriptionSqlPool;
  context?:()=>LiveApplicationContext|undefined; development?:boolean}):IRouter {
  const router = Router(), source = deps.context ?? releasedLiveApplicationContext;
  router.get(["/subscription-enforcement/me","/subscription-enforcement/live/me"], (req,res,next) => {
    res.setHeader("Cache-Control","private, no-store");
    const context = source();
    if (!context && req.path === "/subscription-enforcement/me") { next(); return; }
    requireAuthentication()(req,res,async error => {
      if (error) { next(error); return; }
      try {
        if (!context || !(deps.development ?? (process.env.NODE_ENV==="development"&&!process.env.REPLIT_DEPLOYMENT))) {
          throw new AuthError(503,"LIVE_SUBSCRIPTION_UNAVAILABLE");
        }
        assertLiveApplicationContext(context);
        const input = selection.parse(req.query), actorId = getUserContext(req).user.id;
        const client = await deps.pool.connect();
        try {
          await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
          await client.query("SET LOCAL statement_timeout='3s'");
          const items = await readLiveFamilyAccess(client,actorId,context,input);
          await client.query("COMMIT");
          res.json(GetMySubscriptionEnforcementResponse.parse(items));
        } catch (failure) {
          await client.query("ROLLBACK").catch(()=>undefined); throw failure;
        } finally { client.release(); }
      } catch (failure) {
        if (failure instanceof z.ZodError) { next(new AuthError(400,"Invalid LIVE selection")); return; }
        if (failure instanceof LiveFinalizationBlocked) { next(new AuthError(503,"LIVE_SUBSCRIPTION_UNAVAILABLE")); return; }
        next(failure);
      }
    });
  });
  return router;
}
