/** Schema writes require a separately approved, target-verified procedure.
 * Never infer database safety from NODE_ENV or a connection-string name.
 */
export function assertReviewOnlySchemaCommand(args, env = {}) {
  const forbidden = new Set(["push", "migrate", "drop", "studio"]);
  if (args.some(arg => forbidden.has(arg))) {
    throw new Error("Schema mutation/interactive tooling is disabled. Generate and review a plan; obtain target verification, backup/recovery evidence and explicit approval before any database change.");
  }
  if (!["generate", "export", "check"].includes(args[0])) {
    throw new Error("Only offline generate/export/check commands are allowed; database-connected and unknown schema commands are disabled.");
  }
  if (env.REPLIT_DEPLOYMENT || env.NODE_ENV === "production") {
    throw new Error("Workspace schema tooling must not run in a Production/deployment context.");
  }
}
