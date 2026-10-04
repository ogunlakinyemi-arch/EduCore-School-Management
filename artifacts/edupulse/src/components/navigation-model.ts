export type NavMode = 'admin' | 'teacher' | 'flat';
export type NavGroupDef = { id: string; label: string; hrefs: string[] };
export type NavSection = { id: string; label: string; hrefs: string[] };

export const adminGroups: NavGroupDef[] = [
  { id: 'students-parents', label: 'Students & Parents', hrefs: ['/students', '/parents', '/student-care', '/behaviour'] },
  { id: 'employees-staff', label: 'Employees & Staff', hrefs: ['/employees', '/teacher-assignments', '/teacher-duty', '/employee-nfc'] },
  { id: 'classes-subjects', label: 'Classes & Subjects', hrefs: ['/classes', '/subjects', '/curriculum', '/lesson-notes'] },
  { id: 'academics', label: 'Academics', hrefs: ['/academics', '/academic-calendar', '/timetable', '/promotion'] },
  { id: 'attendance', label: 'Attendance', hrefs: ['/attendance'] },
  { id: 'assessments-results', label: 'Assessments & Results', hrefs: ['/academic-work', '/results'] },
  { id: 'finance', label: 'Finance', hrefs: ['/finance', '/finance-workspace', '/subscriptions', '/subscription-enforcement'] },
  { id: 'communication', label: 'Communication', hrefs: ['/communications', '/inbox'] },
  { id: 'transport', label: 'Transport', hrefs: ['/transport'] },
  { id: 'library', label: 'Library', hrefs: ['/library'] },
  { id: 'operations', label: 'Operations', hrefs: ['/operations'] },
  { id: 'security-nfc', label: 'School Security/NFC', hrefs: ['/security', '/cards'] },
  { id: 'admissions', label: 'Admissions', hrefs: ['/admissions'] },
  { id: 'reports', label: 'Reports', hrefs: ['/reporting', '/audit'] },
  { id: 'settings', label: 'Settings', hrefs: ['/users', '/people/imports', '/school-branding', '/notification-settings'] },
];

export const teacherGroups: NavGroupDef[] = [
  { id: 'my-classes', label: 'My Classes', hrefs: ['/classes', '/students', '/student-care', '/behaviour'] },
  { id: 'my-subjects', label: 'My Subjects', hrefs: ['/subjects', '/curriculum', '/lesson-notes'] },
  { id: 'assignments', label: 'Assignments', hrefs: ['/teacher-assignments'] },
  { id: 'assessments', label: 'Assessments & Marking', hrefs: ['/academic-work'] },
  { id: 'results', label: 'Results', hrefs: ['/results', '/reporting'] },
  { id: 'timetable', label: 'Timetable', hrefs: ['/timetable', '/academic-calendar'] },
  { id: 'attendance', label: 'Attendance', hrefs: ['/attendance'] },
  { id: 'duty', label: 'Duty', hrefs: ['/teacher-duty', '/security'] },
  { id: 'communication', label: 'Communication', hrefs: ['/communications', '/inbox'] },
  { id: 'library', label: 'Library', hrefs: ['/library'] },
  { id: 'payslips', label: 'Payslips', hrefs: ['/my-payslips'] },
  { id: 'profile', label: 'Profile', hrefs: ['/my-employee-nfc', '/my-nfc-subscription', '/notification-settings'] },
];

export function navMode(roles: string[], restricted: boolean): NavMode {
  if (restricted) return 'flat';
  if (roles.includes('SCHOOL_ADMIN')) return 'admin';
  if (roles.includes('TEACHER')) return 'teacher';
  return 'flat';
}

/** Groups already-authorized hrefs. Unlisted authorized links go to "More"; nothing is added or dropped. */
export function buildNavSections(visibleHrefs: string[], mode: NavMode): NavSection[] {
  if (mode === 'flat') return [];
  const defs = mode === 'admin' ? adminGroups : teacherGroups;
  const visible = new Set(visibleHrefs.filter(h => h !== '/'));
  const used = new Set<string>();
  const sections: NavSection[] = [];
  for (const g of defs) {
    const hrefs = g.hrefs.filter(h => visible.has(h) && !used.has(h));
    hrefs.forEach(h => used.add(h));
    if (hrefs.length) sections.push({ id: g.id, label: g.label, hrefs });
  }
  const rest = [...visible].filter(h => !used.has(h));
  if (rest.length) sections.push({ id: 'more', label: 'More', hrefs: rest });
  return sections;
}

export function isNavActive(href: string, location: string) {
  if (href === '/') return location === '/';
  if (href === '/activation') return location === '/activation';
  return location === href || location.startsWith(href + '/');
}
