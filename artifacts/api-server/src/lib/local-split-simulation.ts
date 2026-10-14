import { LOCAL_SPLIT_SIMULATION_MODE } from "./local-split-simulation-barrier";

export type LocalSplitSimulationInput = {
  mode: typeof LOCAL_SPLIT_SIMULATION_MODE;
  exampleSchoolId: 1496;
  action: "PREVIEW" | "REVIEW" | "ENABLE" | "DISABLE" | "RESET";
  acknowledgeFictional: boolean;
};

/** Pure, stateless arithmetic preview. Never a recipient/payment/configuration row. */
export function buildLocalSplitSimulation(input: LocalSplitSimulationInput) {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Local split simulation is restricted to unpublished Development");
  }
  if (input.mode !== LOCAL_SPLIT_SIMULATION_MODE || input.exampleSchoolId !== 1496
      || !["PREVIEW","REVIEW","ENABLE","DISABLE","RESET"].includes(input.action)) {
    throw new Error("Invalid local-only simulation request");
  }
  if (["REVIEW","ENABLE"].includes(input.action) && input.acknowledgeFictional !== true) {
    throw new Error("Acknowledge TEST / NOT REAL before simulated review or enablement");
  }
  return Object.freeze({
    mode: LOCAL_SPLIT_SIMULATION_MODE, label: "TEST / NOT REAL" as const,
    exampleSchoolId: 1496 as const,
    exampleSchoolName: "Academic Calendar QA — reference only; no school record is read or modified",
    simulationRecipientId: "SIMULATION_NOT_REAL_RECIPIENT_1496",
    fictionalBusiness: "TEST / NOT REAL — Fictional QA recipient",
    fictionalContact: "qa-recipient@fixture.invalid",
    fictionalPhone: "SIMULATION_NOT_REAL_PHONE",
    fictionalBank: "TEST / NOT REAL — NO BANK",
    fictionalBankCode: "SIMULATION_NOT_REAL_BANK",
    fictionalAccount: "SIMULATION_NOT_REAL_ACCOUNT",
    recipientState: "LOCAL_ONLY_UNVERIFIED" as const,
    reviewedForSimulation: ["REVIEW","ENABLE"].includes(input.action),
    simulatedEnabled: input.action === "ENABLE",
    operationalEnabled: false as const, testReady: false as const,
    ownershipVerified: false as const, providerVerified: false as const,
    checkoutAllowed: false as const, webhooksAllowed: false as const,
    allocationProven: false as const, bankSettlementVerified: false as const,
    providerFeesIncluded: false as const, noPartner: true as const,
    simulationTotalMinor: 500000, simulationSchoolMinor: 200000,
    simulationPlatformGrossMinor: 300000,
    notice: "TEST / NOT REAL. In-memory simulation only. Provider fees excluded; net is not calculated. No actual allocation, ownership, provider verification or bank settlement is proven. Reload resets the simulation. Legitimate onboarding must create a separate operational recipient through the Owner workflow.",
  });
}
