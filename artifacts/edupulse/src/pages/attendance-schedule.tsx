import { Link } from 'wouter';
import { useGetAuthorizedContext } from '@workspace/api-client-react';
import { PageHeading, SkeletonPage, TenantPicker, useTenant } from '@/components/shared';
import { SchoolAttendanceSchedulePanel } from '@/components/school-attendance-schedule';

/** An independent entry point: never wait for school-wide attendance reports.
 * The existing schedule form/API owns validation, revision and tenant persistence.
 */
export function AttendanceSchedulePage() {
  const { schoolId } = useTenant();
  const context = useGetAuthorizedContext();
  if (context.isLoading) return <SkeletonPage />;
  const authorized = context.data && !context.data.isPlatformOwner
    && context.data.roles?.some(r => r.role === 'SCHOOL_ADMIN'
      && r.status === 'ACTIVE' && r.schoolId === schoolId);
  return <div className="fade-up min-w-0" data-testid="page-attendance-schedule">
    <PageHeading eyebrow="Attendance / Schedule" title="Attendance schedule"
      description="Configure this school's weekday and Friday closing times, missing-tag-out review times, and attendance rules."
      action={<div className="flex min-w-0 flex-wrap items-center gap-3">
        <TenantPicker />
        <Link href="/attendance" className="text-sm font-semibold underline underline-offset-4">Back to attendance</Link>
      </div>} />
    {!schoolId ? <div className="panel p-5" role="status">Select your school to configure its attendance schedule.</div>
      : !authorized ? <div className="panel p-5" role="alert">Only an active School Admin for the selected school can configure its attendance schedule.</div>
      : <SchoolAttendanceSchedulePanel key={schoolId} schoolId={schoolId} canEdit />}
  </div>;
}
