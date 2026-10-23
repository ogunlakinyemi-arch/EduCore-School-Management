import app from "./app";
import {startTelegramWorker} from "./services/telegram-worker";
import { pool, setDatabaseDiagnosticReporter } from "@workspace/db";
import { logger } from "./lib/logger";
import { createGuardedBackgroundTask } from "./lib/background-task";
import { dispatchCommunicationDeliveries } from "./services/communication-service";
import { createDevelopmentCommunicationProviders } from "./services/communication-providers";
import { reconcileFinanceCommunicationIntents } from "./routes/finance-communication-service";
import { evaluateSubscriptionSchools } from "./services/subscription-enforcement";
import { developmentWorkersPaused } from "./lib/development-worker-policy";
import { assessDevelopmentSchools } from "./services/attendance-scheduler";
import { queueStudentAttendanceCommunication } from "./routes/attendance";
import { verifyRemovalRuntimeTarget } from "./services/development-settlement-removal";

// Route sanitized pool diagnostics (SQLSTATE/category only) into structured logs.
setDatabaseDiagnosticReporter((event, diagnostic) => {
  logger.warn({ databaseDiagnostic: { event, ...diagnostic } }, "Database connection event");
});

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  if (process.env.NODE_ENV === "development" && !process.env.REPLIT_DEPLOYMENT) {
    logger.info({databaseTarget:pool.targetDiagnostic,configurationSource:
      process.env.EDUCORE_TERMINAL_TEST_MODE !== undefined ? "EXPLICIT_TERMINAL_TEST_TARGET" : "DATABASE_URL_PG_RESOLUTION",
      communicationWorkerUsesApiPool:true}, "Development database configuration provenance");
  }
  startTelegramWorker();
  if (process.env.NODE_ENV === "development" && !process.env.REPLIT_DEPLOYMENT) {
    void verifyRemovalRuntimeTarget().then((verified) => {
      logger.info({ developmentSettlementRemovalIsolation: verified },
        verified ? "Development settlement removal target verified; every action rechecks isolation"
          : "Development settlement removal disabled: runtime target isolation is not confirmed");
    });
  }
  if (developmentWorkersPaused()) {
    logger.warn("Development subscription and notification workers paused for controlled verification");
    return;
  }
  let lastSubscriptionEvaluation = 0;
  const dispatch = createGuardedBackgroundTask("Communication delivery worker", async () => {
    if (Date.now() - lastSubscriptionEvaluation >= 60_000) {
      await evaluateSubscriptionSchools();
      await assessDevelopmentSchools(queueStudentAttendanceCommunication);
      lastSubscriptionEvaluation = Date.now();
    }
    await reconcileFinanceCommunicationIntents(pool, 50);
    await dispatchCommunicationDeliveries(pool, 50, {
      allowConfiguredProviders: process.env.NODE_ENV === "production",
      providers: process.env.NODE_ENV === "production" ? undefined :
        createDevelopmentCommunicationProviders(process.env),
    });
  }, logger);
  void dispatch();
  setInterval(() => void dispatch(), 15_000).unref();
});
