import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ schoolId: 1 }));
vi.mock('@/components/shared', () => ({
  useTenant: () => ({ schoolId: state.schoolId }),
  PageHeading: ({ title, action }: any) => <header>{title}{action}</header>,
  TenantPicker: () => <span>School context</span>,
  EmptyState: ({ title }: any) => <p>{title}</p>,
}));
import { RecordsPage } from './records';
vi.mock('wouter', () => ({ Link: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a> }));
beforeEach(() => { state.schoolId = 1; });
it('links all four record categories to existing directories without mutation controls', () => {
  const html = renderToStaticMarkup(<RecordsPage />);
  for (const href of ['/students', '/parents', '/employees']) expect(html).toContain(`href="${href}"`);
  for (const title of ['Student records', 'Teacher records', 'Staff records', 'Parent / guardian records']) expect(html).toContain(title);
  expect(html).not.toContain('<form');
});
it('requires a school context before displaying directory links', () => {
  state.schoolId = 0;
  const html = renderToStaticMarkup(<RecordsPage />);
  expect(html).toContain('Select a school context');
  expect(html).not.toContain('href="/students"');
});
