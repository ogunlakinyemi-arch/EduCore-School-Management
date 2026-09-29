import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { dispatchCommunicationDeliveries } from "./services/communication-service";
import { reconcileFinanceCommunicationIntents } from "./routes/finance-communication-service";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Provider work runs after request transactions commit. In development the
  // dispatcher uses no-network adapters; real providers require explicit setup.
  let dispatching = false;
  const dispatch = async () => {
    if (dispatching) return;
    dispatching = true;
    try {
      // The existing invoice notification ledger is durable. Reconcile any
      // missed channel intents before claiming due deliveries.
      await reconcileFinanceCommunicationIntents(pool, 50);
      await dispatchCommunicationDeliveries(pool, 50, {
        allowConfiguredProviders: process.env.NODE_ENV === "production",
      });
    } catch (error) {
      logger.error({ error }, "Communication delivery worker failed");
    } finally {
      dispatching = false;
    }
  };
  void dispatch();
  setInterval(() => void dispatch(), 15_000).unref();
});
