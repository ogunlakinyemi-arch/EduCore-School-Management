import { useQuery } from '@tanstack/react-query';
import { customFetch, useGetAuthorizedContext } from '@workspace/api-client-react';

type School = { id: number; name: string };
type Term = { id: number; schoolId: number; name: string; sessionName: string; startDate: string; endDate: string };
type Student = { id: number; schoolId: number; firstName: string; lastName: string; admissionNo: string };
type PeriodOptions = { schools: School[]; terms: Term[] };

/** Reuse existing Owner-authorized, read-only school/period and roster endpoints. */
export function useOwnerPaymentOptions(schoolId: string) {
  const context = useGetAuthorizedContext().data;
  const authorized = context?.user?.status === 'ACTIVE' && context.roles.some(r =>
    r.role === 'PLATFORM_OWNER' && r.schoolId === null && r.status === 'ACTIVE');
  const identity = context?.user?.id;
  const schools = useQuery({
    queryKey: ['owner-payment-schools', identity],
    queryFn: ({ signal }) => customFetch<PeriodOptions>('/api/platform/nfc-fee-collection-oversight/filter-options', { signal }),
    enabled: authorized, retry: false, staleTime: 0, placeholderData: undefined,
  });
  const selectedSchool = schools.data?.schools.some(s => String(s.id) === schoolId) === true;
  const choices = useQuery({
    queryKey: ['owner-payment-choices', identity, schoolId],
    queryFn: async ({ signal }) => {
      const [periods, students] = await Promise.all([
        customFetch<PeriodOptions>(`/api/platform/nfc-fee-collection-oversight/filter-options?schoolId=${schoolId}`, { signal }),
        customFetch<Student[]>(`/api/students?schoolId=${schoolId}&status=active`, { signal }),
      ]);
      return {
        terms: periods.terms.filter(t => String(t.schoolId) === schoolId),
        students: students.filter(s => String(s.schoolId) === schoolId),
      };
    },
    enabled: authorized && selectedSchool, retry: false, staleTime: 0, placeholderData: undefined,
  });
  return { authorized, schools, choices, selectedSchool };
}
