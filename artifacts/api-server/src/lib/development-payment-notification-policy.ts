/**
 * A Development payment-test lock must not affect a deployed application.
 * Keep the worker pause as an additional send-time guard: pausing a scheduler
 * alone does not protect manual dispatch or already-created provider objects.
 */
export function developmentPaymentNotificationsSuppressed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === "development" && !env.REPLIT_DEPLOYMENT
    && (env.EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED === "true"
      || env.EDUCORE_DEVELOPMENT_WORKERS_PAUSED === "true");
}
