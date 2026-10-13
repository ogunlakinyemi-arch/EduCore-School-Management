// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcademicsPage } from "./academics";

const state = vi.hoisted(() => ({
  mutation: vi.fn(), terms: vi.fn(),
  sessions: [
    { id: 369, name: "2027/2028", status: "INACTIVE", isCurrent: false, startDate: "2027-09-13", endDate: "2028-07-21" },
    { id: 358, name: "2026/2027", status: "ACTIVE", isCurrent: true, startDate: "2026-09-14", endDate: "2027-07-23" },
  ],
}));
vi.mock("@workspace/api-client-react", () => ({
  useListAcademicSessions: () => ({ data: state.sessions, isLoading: false }),
  getListAcademicSessionsQueryKey: () => ["sessions"],
  useListAcademicTerms: state.terms,
  getListAcademicTermsQueryKey: (id: number) => ["terms", id],
  useCreateAcademicTerm: () => ({ mutate: state.mutation, isPending: false }),
  useUpdateAcademicTerm: () => ({ mutate: state.mutation, isPending: false }),
}));
vi.mock("@/components/shared", () => ({
  useTenant: () => ({ schoolId: 1393, setSchoolId: vi.fn() }),
  useSchoolAdminAccess: () => ({ canManageSchool: true }),
  date: (value: string) => value,
  cx: (...values: string[]) => values.filter(Boolean).join(" "),
  PageHeading: () => <h1>Academic Calendar</h1>,
  TenantPicker: () => null,
  Button: ({ children, testId, ...props }: any) => <button data-testid={testId} {...props}>{children}</button>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
  Field: ({ label, children }: any) => <label>{label}{children}</label>,
  Modal: ({ children }: any) => <div role="dialog">{children}</div>,
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.terms.mockImplementation((id: number) => ({
    data: [{ id: id === 358 ? 20 : 35, sessionId: id, name: "FIRST",
      status: id === 358 ? "ACTIVE" : "INACTIVE", isCurrent: id === 358,
      startDate: id === 358 ? "2026-09-21" : "2027-09-13",
      endDate: id === 358 ? "2026-12-18" : "2027-12-10" }],
    isLoading: false, isError: false,
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() {
  await act(async () => root.render(
    <QueryClientProvider client={new QueryClient()}><AcademicsPage /></QueryClientProvider>,
  ));
}
describe("Current academic period for school 1393 (mocked saved Development state)", () => {
  it("selects current 2026/2027 ahead of the newer inactive future session", async () => {
    await render();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Term session"]')?.value).toBe("358");
    expect(state.terms).toHaveBeenCalledWith(358, { schoolId: 1393 }, expect.anything());
    expect(host.querySelector('[data-testid="panel-terms"]')?.textContent).toContain("Current");
    expect(state.mutation).not.toHaveBeenCalled();
  });
  it("allows switching sessions and returning to the current FIRST term without mutation", async () => {
    await render();
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Term session"]')!;
    for (const value of ["369", "358"]) {
      await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(select.value).toBe(value);
    }
    expect(host.querySelector('[data-testid="panel-terms"]')?.textContent).toContain("Current");
    expect(state.mutation).not.toHaveBeenCalled();
  });
});
