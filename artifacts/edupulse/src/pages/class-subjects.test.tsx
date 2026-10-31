import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@workspace/api-client-react", () => ({ useSaveClassSubjectSetup: () => ({ isPending: false, mutateAsync: vi.fn() }) }));
vi.mock("wouter", () => ({ Link: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/shared", () => ({
  Button: ({ children, testId, disabled }: { children: ReactNode; testId?: string; disabled?: boolean }) => <button data-testid={testId} disabled={disabled}>{children}</button>,
  EmptyState: ({ title, action }: { title: string; action?: ReactNode }) => <div>{title}{action}</div>,
  ErrorState: ({ message }: { message: string }) => <div role="alert">{message}</div>,
  SkeletonPage: () => <div>loading</div>, Field: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageHeading: () => null, TenantPicker: () => null, useTenant: () => ({ schoolId: 1 }),
  useSchoolAdminAccess: () => ({ canManageSchool: true }), cx: (...v: unknown[]) => v.filter(Boolean).join(" "),
}));

import { SubjectLinkForm } from "./class-subjects";
import { buildSetupPayload, exactScopeLinks, initialChoices, inheritedSessionLinks, implicitStaffingLinks, retainedOtherLinks, eligibleSetupTeachers, setupTeacherChoices, scopeQuery, urlScopeId } from "./class-subject-setup-model";

const session: any = { id: 10, schoolId: 1, startDate: "2025-09-01", endDate: "2026-07-31" };
const link = (id: number, subjectId: number, termId: number | null, extra: any = {}): any => ({ id, schoolId: 1, sessionId: 10, classId: 5, subjectId, termId, section: null, teacherId: null, status: "ACTIVE", ...extra });
const staff = (subjectId: number, teacherId = 7): any => ({ id: 90 + subjectId, schoolId: 1, sessionId: 10, classId: 5, section: "", subjectId, teacherId, assignmentType: "SUBJECT_TEACHER", status: "ACTIVE", startDate: "2025-09-01", endDate: null });
const teacher: any = { id: 7, schoolId: 1, type: "TEACHER", status: "ACTIVE", firstName: "Adaeze", lastName: "Okafor" };
const whole = { schoolId: 1, sessionId: 10, termId: null, classId: 5, section: "A" };
const term = { ...whole, termId: 3 };
const links = [link(1, 100, null), link(2, 101, 3, { teacherId: 7 }), link(3, 102, 4), link(4, 103, 3, { status: "INACTIVE" })];

describe("class subject setup model", () => {
  it("uses exact active scope links as the stale-edit guard", () => {
    expect(exactScopeLinks(links, whole).map(a => a.id)).toEqual([1]);
    expect(exactScopeLinks(links, term).map(a => a.id)).toEqual([2]);
    expect(exactScopeLinks([link(9, 100, null, { section: "B" })], whole)).toEqual([]);
  });
  it("shows inherited annual links read-only and excludes them from own checkboxes", () => {
    expect(inheritedSessionLinks(links, term).map(a => a.subjectId)).toEqual([100]);
    expect([...initialChoices(links, [], session, term).keys()]).toEqual([101]);
    expect(retainedOtherLinks(links, term).map(a => a.id)).toEqual([3, 4]);
  });
  it("counts staffing-only grants as implicit only without any class_subjects row", () => {
    expect(implicitStaffingLinks(links, [staff(200), staff(102)], session, whole).map(a => a.subjectId)).toEqual([200]);
    expect(initialChoices(links, [staff(200)], session, whole).get(200)).toEqual({ subjectId: 200, teacherId: null });
  });
  it("builds an exact, de-duplicated payload", () => {
    const m = new Map([[101, { subjectId: 101, teacherId: 7 }], [100, { subjectId: 100, teacherId: null }]]);
    expect(buildSetupPayload(term, [2, 2], m)).toEqual({ schoolId: 1, classId: 5, sessionId: 10, termId: 3, expectedAssignmentIds: [2], subjects: [{ subjectId: 100, teacherId: null }, { subjectId: 101, teacherId: 7 }] });
  });
  it("lists eligible teachers from current staffing only", () => {
    expect(eligibleSetupTeachers([teacher], [staff(101)], session, whole, 101).map(t => t.id)).toEqual([7]);
    expect(eligibleSetupTeachers([teacher], [staff(101)], session, whole, 999)).toEqual([]);
  });
  it("honours URL scope only for the current tenant", () => {
    expect(urlScopeId("?schoolId=1&classId=5", 1, "classId")).toBe(5);
    expect(urlScopeId("?schoolId=2&classId=5", 1, "classId")).toBeUndefined();
    expect(scopeQuery({ schoolId: 1, sessionId: 10, termId: 3, classId: 5 })).toBe("schoolId=1&sessionId=10&termId=3&classId=5");
  });
});

const render = (props: any) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><SubjectLinkForm
  session={session} className="JSS1 A" terms={[{ id: 3, name: "FIRST" }, { id: 4, name: "SECOND" }]} teachers={[teacher]}
  subjects={[{ id: 100, name: "Mathematics", schoolId: 1 }, { id: 101, name: "Biology", schoolId: 1 }, { id: 300, name: "French", schoolId: 1 }]}
  links={links} staffing={[]} syncing={false} onDirty={() => {}} onSaved={async () => {}} {...props} /></QueryClientProvider>);

describe("subject link controls", () => {
  it("renders each catalogue subject once with inherited guidance", () => {
    const html = render({ scope: term });
    expect(html.match(/data-testid="checkbox-subject-100"/g)).toHaveLength(1);
    expect(html).toContain("Select Whole session to edit");
    expect(html).toContain("data-testid=\"panel-retained\"");
    expect(html).toContain("/teacher-assignments?schoolId=1&amp;sessionId=10&amp;termId=3&amp;classId=5");
  });
  it("offers linking without a teacher when none is eligible", () => {
    const html = render({ scope: whole });
    expect(html).toContain("No teacher is assigned yet; you can still link the subject.");
    expect(html).toContain('value="" selected=""');
  });
  it("offers every active school teacher, excluding staff, inactive and foreign", () => {
    const pool = [teacher, { ...teacher, id: 8, firstName: "Unassigned", employmentStatus: "active" },
      { ...teacher, id: 9, firstName: "Staffer", type: "STAFF" }, { ...teacher, id: 11, firstName: "Gone", status: "INACTIVE" },
      { ...teacher, id: 12, firstName: "Foreign", schoolId: 2 }];
    expect(setupTeacherChoices(pool as any, 1).map(t => t.id)).toEqual([7, 8]);
    const html = render({ scope: whole, teachers: pool, links: [link(1, 100, null, { teacherId: 8 })] });
    expect(html).toMatch(/<option value="8" selected="">Unassigned Okafor<\/option>/);
    expect(html).not.toContain("Staffer"); expect(html).not.toContain("Gone"); expect(html).not.toContain("Foreign");
  });
  it("shows the empty catalogue state", () => {
    expect(render({ scope: whole, subjects: [] })).toContain("The subject catalogue is empty");
  });
});
