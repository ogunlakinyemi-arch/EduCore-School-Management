import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import { hostedManualPaymentsRouter, hostedManualWebhookRouter } from "./routes/hosted-manual-payments";
import { rejectRetiredPaymentWorkflows } from "./services/retired-payment-workflows";
import { directStudentPublicRouter,directStudentWebhookRouter } from "./routes/direct-student-live-payments";
import { paymentReceiptsRouter } from "./routes/payment-receipts";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { ownerUidIngestionRouter } from "./routes/owner-uid-reader";
import { idCardVerificationRouter } from "./routes/id-card-verification";
import feeProviderWebhookRouter from "./routes/fee-provider-webhooks";
import communicationReceiptRouter from "./routes/communication-receipts";
import { staffFlutterwaveWebhookRouter } from "./routes/staff-nfc-billing";
import { studentSubscriptionFlutterwaveWebhookRouter } from "./routes/student-subscription-webhooks";
import { studentSubscriptionLiveWebhookRouter } from "./routes/student-subscription-live-webhooks";
import flutterwaveLiveRuntimeRouter from "./routes/flutterwave-live-runtime";
import {paymentAccountProvidersRouter} from "./routes/payment-account-providers";
import { logger } from "./lib/logger";
import { AuthError } from "./middlewares/auth";
import { rejectSimulationWebhook } from "./middlewares/local-split-simulation";
import terminalEventsRouter from "./routes/terminal-events";
import healthRouter from "./routes/health";
import {pool} from "@workspace/db";
import {runtimeDatabaseIdentity} from "./services/runtime-database-identity";

const app: Express = express();
// Allowlisted configuration identity only: no connection strings, credentials,
// resolved hostnames, database/user names or inferred platform resource IDs.
logger.info({eventType:"DATABASE_RUNTIME_IDENTITY",
  runtimeDatabase:runtimeDatabaseIdentity(pool.targetDiagnostic)},
  "Database runtime configuration identity; resource binding is not certified");

const trustedCorsOriginsEnv = "CORS_ALLOWED_ORIGINS";
const safeErrorCodes = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

function safeErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "UNCLASSIFIED";
  }
  const code = (error as { code: unknown }).code;
  return typeof code === "string" && safeErrorCodes.has(code)
    ? code
    : "UNCLASSIFIED";
}

function corsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) {
  if (!origin) {
    callback(null, false);
    return;
  }

  // Preserve the development preview/proxy behavior, but require an explicit
  // deployment allowlist for every cross-origin production request.
  if (process.env.NODE_ENV !== "production") {
    callback(null, true);
    return;
  }

  const trustedOrigins = (process.env[trustedCorsOriginsEnv] ?? "")
    .split(",")
    .map((trustedOrigin) => trustedOrigin.trim())
    .filter(Boolean);
  callback(null, trustedOrigins.includes(origin));
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// These two GET/HEAD routes must terminate before ANY identity/payment/device
// routers. Do not move general API routes here or exempt them from authorization.
app.use(["/api/healthz","/api/readyz"],cors({credentials:true,origin:corsOrigin}));
app.use("/api",healthRouter);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use("/api", terminalEventsRouter);
app.use("/api", ownerUidIngestionRouter);
app.use("/api", idCardVerificationRouter);
app.use(cors({ credentials: true, origin: corsOrigin }));
app.use("/api/communication/provider-receipts", express.raw({ type: "application/json", limit: "64kb" }), communicationReceiptRouter);
// Provider callbacks are public and require the untouched raw bytes for
// signature verification. This mount deliberately precedes Clerk and JSON parsing.
app.use(
  "/api/finance/provider-webhooks",
  express.raw({ type: "application/json", limit: "64kb" }),
  rejectSimulationWebhook,
  feeProviderWebhookRouter,
);
app.use(
  "/api/webhooks/flutterwave/staff-nfc",
  express.raw({ type: "application/json", limit: "64kb" }),
  rejectSimulationWebhook,
  staffFlutterwaveWebhookRouter,
);
app.use(
  "/api/webhooks/flutterwave/student-subscription",
  express.raw({ type: "application/json", limit: "64kb" }),
  rejectSimulationWebhook,
  studentSubscriptionFlutterwaveWebhookRouter,
);
app.use(
  "/api/webhooks/flutterwave/live/student-subscription",
  express.raw({ type: "application/json", limit: "64kb" }),
  rejectSimulationWebhook,
  studentSubscriptionLiveWebhookRouter,
);
app.use("/api/webhooks/flutterwave/hosted-manual",
  express.raw({ type: "application/json", limit: "64kb" }), hostedManualWebhookRouter);
app.use("/api/webhooks/flutterwave/direct-student",
  express.raw({type:"application/json",limit:"64kb"}),directStudentWebhookRouter);
app.use("/api",directStudentPublicRouter);
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
// Only Exam/Record accepts bounded base64 document bodies and bulk score grids.
// Keep existing parser limits and raw payment-webhook handling unchanged elsewhere.
app.use("/api/exam-record",express.json({limit:"8mb"}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api",rejectRetiredPaymentWorkflows);
app.use("/api", flutterwaveLiveRuntimeRouter);
app.use("/api/hosted-payments", hostedManualPaymentsRouter);
app.use("/api/payment-receipts", paymentReceiptsRouter);
app.use("/api", paymentAccountProvidersRouter);
app.use("/api", router);
app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error);
  if (error instanceof AuthError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.eventType,
    });
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    "status" in error
  ) {
    const parserError = error as { type: unknown; status: unknown };
    if (parserError.type === "entity.parse.failed" && parserError.status === 400) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    if (parserError.type === "entity.too.large" && parserError.status === 413) {
      return res.status(413).json({ error: "Request body too large" });
    }
  }
  req.log.error(
    { category: "unhandled_api_error", code: safeErrorCode(error) },
    "Unhandled API error",
  );
  return res.status(500).json({ error: "Internal server error" });
});

export default app;
