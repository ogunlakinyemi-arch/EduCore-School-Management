import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import feeProviderWebhookRouter from "./routes/fee-provider-webhooks";
import communicationReceiptRouter from "./routes/communication-receipts";
import { staffFlutterwaveWebhookRouter } from "./routes/staff-nfc-billing";
import { studentSubscriptionFlutterwaveWebhookRouter } from "./routes/student-subscription-webhooks";
import { logger } from "./lib/logger";
import { AuthError } from "./middlewares/auth";

const app: Express = express();

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
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: corsOrigin }));
app.use("/api/communication/provider-receipts", express.raw({ type: "application/json", limit: "64kb" }), communicationReceiptRouter);
// Provider callbacks are public and require the untouched raw bytes for
// signature verification. This mount deliberately precedes Clerk and JSON parsing.
app.use(
  "/api/finance/provider-webhooks",
  express.raw({ type: "application/json", limit: "64kb" }),
  feeProviderWebhookRouter,
);
app.use(
  "/api/webhooks/flutterwave/staff-nfc",
  express.raw({ type: "application/json", limit: "64kb" }),
  staffFlutterwaveWebhookRouter,
);
app.use(
  "/api/webhooks/flutterwave/student-subscription",
  express.raw({ type: "application/json", limit: "64kb" }),
  studentSubscriptionFlutterwaveWebhookRouter,
);
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
