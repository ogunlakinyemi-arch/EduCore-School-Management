import { LiveFinalizationBlocked } from "./flutterwave-live-verification";

/** Default denied. The SCV3 runtime may construct a capability only AFTER
 * server configuration plus target release manifest/schema checks. Fixtures
 * inject capabilities independently; HTTP request data is never authority. */
export interface LiveWorkflowCapability { readonly enabled: boolean }
export const blockedLiveWorkflow: LiveWorkflowCapability = Object.freeze({ enabled: false });
export function requireLiveWorkflow(capability: LiveWorkflowCapability = blockedLiveWorkflow) {
  if (!capability.enabled) throw new LiveFinalizationBlocked("LIVE_WORKFLOW_RELEASE_DISABLED");
}
