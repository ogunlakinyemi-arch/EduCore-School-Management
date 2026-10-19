import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ status: "ARCHIVED", error: null as unknown }));
vi.mock("@workspace/api-client-react", () => ({
  useListAcademicAssignments: () => ({ data: [{ id: 701, title: "Retained assignment", status: state.status, classId: 4, subjectId: 5, maxScore: 20, dueDate: "2026-03-08" }] }),
  getListAcademicAssignmentsQueryKey: () => ["assignments"],
  useListAcademicSessions: () => ({ data: [{ id: 2, name: "Session", isCurrent: true }] }),
  useListAcademicTerms: () => ({ data: [{ id: 3, name: "Third", isCurrent: true }] }),
  useListClasses: () => ({ data: [] }),
  useListSubjects: () => ({ data: [] }),
  useCreateAcademicAssignment: () => ({ isPending: false, error: null }),
  useUpdateAcademicAssignment: () => ({ isPending: false, error: state.error }),
}));
vi.mock("@/components/shared", () => ({
  useTenant: () => ({ schoolId: 1 }),
  useSchoolAdminAccess: () => ({ isPlatformOwner: false, isSchoolAdmin: true }),
  PageHeading: () => null, TenantPicker: () => null,
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  Field: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StatusPill: ({ value }: { value: string }) => <span>{value}</span>,
  date: (value: string) => value, cx: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
import { AcademicWorkPage, AssignmentForm } from "./academic-work";

beforeEach(() => { state.status = "ARCHIVED"; state.error = null; });
const page = () => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}><AcademicWorkPage /></QueryClientProvider>,
);
describe("assignment retention UI", () => {
  it("shows the retained archived record without an Edit control", () => {
    const html = page();
    expect(html).toContain("Retained assignment");
    expect(html).toContain("Read-only history");
    expect(html).not.toContain("Edit assignment:");
  });
  it("keeps draft editing available", () => {
    state.status = "DRAFT";
    expect(page()).toContain("Edit assignment: Retained assignment");
  });
  it("shows the server conflict if another administrator archives an open edit", () => {
    state.error = { data: { error: "Archived assignments are read-only. Create a new assignment instead of changing retained academic history." } };
    const html = renderToStaticMarkup(<AssignmentForm schoolId={1} sessionId={2} termId={3}
      classes={[]} subjects={[]} initial={{ id: 701, title: "Stale draft", status: "DRAFT" }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Archived assignments are read-only");
  });
});
