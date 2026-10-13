/** A verification pause applies only to the unpublished Development API. */
export function developmentWorkersPaused(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "development" && !env.REPLIT_DEPLOYMENT
    && env.EDUCORE_DEVELOPMENT_WORKERS_PAUSED === "true";
}
