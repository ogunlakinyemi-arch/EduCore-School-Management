import app from "./app";
import {startDevelopmentTelegramWorker} from "./services/telegram-worker";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { dispatchCommunicationDeliveries } from "./services/communication-service";
import { createDevelopmentCommunicationProviders } from "./services/communication-providers";
import { reconcileFinanceCommunicationIntents } from "./routes/finance-communication-service";
import { evaluateSubscriptionSchools } from "./services/subscription-enforcement";
import { developmentWorkersPaused } from "./lib/development-worker-policy";
import { verifyRemovalRuntimeTarget } from "./services/development-settlement-removal";

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
  startDevelopmentTelegramWorker();
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
  let dispatching = false;
  let lastSubscriptionEvaluation = 0;
  const dispatch = async () => {
    if (dispatching) return;
    dispatching = true;
    try {
      if (Date.now() - lastSubscriptionEvaluation >= 60_000) {
        await evaluateSubscriptionSchools();
        lastSubscriptionEvaluation = Date.now();
      }
      await reconcileFinanceCommunicationIntents(pool, 50);
      await dispatchCommunicationDeliveries(pool, 50, {
        allowConfiguredProviders: process.env.NODE_ENV === "production",
        providers: process.env.NODE_ENV === "production" ? undefined :
          createDevelopmentCommunicationProviders(process.env),
      });
    } catch (error) {
      logger.error({ error }, "Communication delivery worker failed");
    } finally { dispatching = false; }
  };
  void dispatch();
  setInterval(() => void dispatch(), 15_000).unref();
});
