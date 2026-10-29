// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  method: null as "FLUTTERWAVE" | null, available: false, error: false,
  requests: vi.fn(),
}));
vi.mock("@workspace/api-client-react", async original => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetSchoolPlatformPaymentMethod: (...args: unknown[]) => {
    state.requests(...args);
    return { data: { method: state.method, available: state.available },
      isLoading: false, isError: state.error, refetch: vi.fn() };
  },
}));
import { PlatformPaymentMethodNotice } from "./finance";
describe("school-facing Owner-configured platform payment notice", () => {
  it.each([
    { method: null, available: false, text: "has not configured an available platform payment method" },
    { method: "FLUTTERWAVE", available: false, text: "Flutterwave. Platform checkout is currently unavailable" },
    { method: "FLUTTERWAVE", available: true, text: "Flutterwave. Availability still depends" },
  ] as const)("shows $text without a school provider picker", ({ method, available, text }) => {
    state.method = method; state.available = available; state.error = false; state.requests.mockClear();
    const html = renderToStaticMarkup(<PlatformPaymentMethodNotice schoolId={7} />);
    expect(html).toContain(text);
    expect(html).toContain("Schools cannot choose or enable a platform provider");
    expect(html).toContain("Ordinary school invoices and separate parent-facing NFC/card fees");
    expect(html).not.toContain("Paystack");
    expect(html).not.toContain("Enable Flutterwave");
    expect(html).not.toContain("BRO commission");
    expect(state.requests.mock.calls[0][0]).toEqual({ schoolId: 7 });
    expect(state.requests.mock.calls[0][1].query.queryKey).toContain("/api/school/finance/platform-payment-method");
  });
  it("fails closed on an unconfirmed Owner method", () => {
    state.error = true;
    const html = renderToStaticMarkup(<PlatformPaymentMethodNotice schoolId={7} />);
    expect(html).toContain("could not be confirmed");
    expect(html).toContain("Do not start a payment");
    expect(html).not.toContain("Platform Owner’s method: Flutterwave");
  });
});
