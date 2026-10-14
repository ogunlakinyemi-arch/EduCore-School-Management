import { z } from "zod";

export const existingDiagnosticTestReference = "RS_5F0DB5C736A2550E783A15B9EB9FBF09";
// Persist scope in the existing review note; encrypted bank identity is immutable.
export const existingTestReviewNotePrefix = `[VERIFY_EXISTING_TEST:${existingDiagnosticTestReference}] `;
export const businessEmailSchema = z.string().trim().max(254).email().refine(value => {
  const domain = value.split("@")[1]?.toLowerCase() ?? "";
  return !/(\.test|\.invalid|\.localhost|\.example)$/.test(domain)
    && !/(^|\.)example\.(com|org|net)$/.test(domain) && domain !== "localhost";
}, "Use the entity's legitimate business contact, not a reserved diagnostic address");

export function maskedBusinessEmail(value?: string) {
  if (!value) return null;
  const [local, domain] = value.split("@");
  return domain ? `${local.slice(0, 1)}•••@${domain}` : null;
}

export const schoolTestSplitInput = z.object({
  enabled: z.boolean(),
  testSplitVerificationAuthorized: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.enabled && !value.testSplitVerificationAuthorized) {
    context.addIssue({ code: "custom", message: "Owner authorization for TEST split verification is required" });
  }
});
