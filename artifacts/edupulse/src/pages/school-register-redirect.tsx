import { Redirect } from 'wouter';

export function SchoolRegisterRedirect() {
  const ref = new URLSearchParams(window.location.search).get('ref');
  const to = `/sign-up?applicantType=SCHOOL_ADMIN${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
  return <Redirect to={to} replace />;
}
