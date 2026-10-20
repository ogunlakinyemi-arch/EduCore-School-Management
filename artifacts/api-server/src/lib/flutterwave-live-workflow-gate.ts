import { LiveFinalizationBlocked } from "./flutterwave-live-verification";

/** No runtime flag or secret can turn this release gate on. Enabled capabilities
 * may be injected ONLY by isolated-fixture tests, never from HTTP request data. */
export interface LiveWorkflowCapability { readonly enabled: boolean }
export const blockedLiveWorkflow: LiveWorkflowCapability = Object.freeze({ enabled: false });
export function requireLiveWorkflow(capability: LiveWorkflowCapability = blockedLiveWorkflow) {
  if (!capability.enabled) throw new LiveFinalizationBlocked("LIVE_WORKFLOW_RELEASE_DISABLED");
}
