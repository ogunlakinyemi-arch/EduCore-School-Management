import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export type Phase9Record = { id: number; schoolId: number; [field: string]: unknown };
export async function phase9Request<T>(path: string, method = 'GET', body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = result && typeof result === 'object' && 'error' in result ? String(result.error) : `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }
  return result as T;
}

// These Phase 9 routes are not present in the generated client yet. Each hook uses
// the actual route's direct JSON response and the application's cookie session.
export function usePhase9List<T>(resource: string, schoolId: number, params: Record<string, string> = {}, enabled = true) {
  const search = new URLSearchParams({ schoolId: String(schoolId), ...params }).toString();
  return useQuery<T>({ queryKey: ['phase9', resource, schoolId, params], enabled: enabled && schoolId > 0, queryFn: () => phase9Request<T>(`/${resource}?${search}`), staleTime: 15_000 });
}

export function usePhase9Save(resource: string, schoolId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data, method }: { id?: number; data: Record<string, unknown>; method?: 'PUT' | 'POST' | 'PATCH' }) =>
      phase9Request<unknown>(`/${resource}${id ? `/${id}` : ''}?schoolId=${schoolId}`, method ?? (id ? 'PATCH' : 'POST'), data),
    onSuccess: () => client.invalidateQueries({ queryKey: ['phase9'] }),
  });
}

export function useLibraryAction(schoolId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = 'POST', data = {} }: { path: string; method?: 'POST' | 'PATCH' | 'DELETE'; data?: Record<string, unknown> }) =>
      phase9Request<unknown>(`/library/${path}${method === 'DELETE' ? `?schoolId=${schoolId}` : ''}`, method, method === 'DELETE' ? undefined : { schoolId, ...data }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['phase9'] }),
  });
}

export function toPayload(values: Record<string, string | number | boolean | null>, numberKeys: string[] = [], clearBlanks = false) {
  return Object.fromEntries(Object.entries(values)
    .filter(([, value]) => clearBlanks || value !== '' && value !== null)
    .map(([key, value]) => [key, value === '' ? null : numberKeys.includes(key) && value !== null ? Number(value) : value]));
}