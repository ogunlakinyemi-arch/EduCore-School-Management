import { describe, expect, it } from "vitest";
import {
  configuredStudentSubscriptionCheckoutBaseUrl,
  studentSubscriptionCheckoutReturnUrl,
} from "./student-subscription-return-url";

describe("student subscription checkout callback URLs", () => {
  it("preserves a trusted production app base path and includes only persisted checkout context", () => {
    expect(studentSubscriptionCheckoutReturnUrl(12, 54, "student_123456789", {
      environment: "production",
      publicAppUrl: "https://school.example/suite",
    })).toBe(
      "https://school.example/suite/subscriptions?subscriptionId=12&paymentId=54&paymentReference=student_123456789",
    );
  });

  it("uses a Replit development-domain fallback only in development", () => {
    expect(studentSubscriptionCheckoutReturnUrl(12, 54, "student_123456789", {
      environment: "development",
      developmentDomain: "app.workspace.replit.dev",
      developmentBasePath: "/preview",
    })).toBe(
      "https://app.workspace.replit.dev/preview/subscriptions?subscriptionId=12&paymentId=54&paymentReference=student_123456789",
    );
    expect(configuredStudentSubscriptionCheckoutBaseUrl({
      environment: "production",
      developmentDomain: "app.workspace.replit.dev",
      publicAppUrl: "",
    })).toBeNull();
  });

  it.each([
    "http://school.example",
    "https://user:password@school.example",
    "https://school.example/?next=https://attacker.example",
    "https://school.example/safe/../admin",
    "https://workspace.replit.dev",
  ])("fails closed for an unsafe configured public base URL: %s", (publicAppUrl) => {
    expect(configuredStudentSubscriptionCheckoutBaseUrl({
      environment: "production",
      publicAppUrl,
    })).toBeNull();
  });

  it("never falls back to a development domain outside NODE_ENV=development", () => {
    const url = configuredStudentSubscriptionCheckoutBaseUrl({
      environment: "production",
      publicAppUrl: undefined,
      developmentDomain: "app.workspace.replit.dev",
    });
    expect(url).toMatch(/^https:\/\/edu-pulse-school-management--ogunlakinyemi\.replit\.app$/);
  });
});