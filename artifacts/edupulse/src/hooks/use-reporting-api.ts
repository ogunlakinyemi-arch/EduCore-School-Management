import { useQuery } from '@tanstack/react-query';

export type ReportCatalogItem = { id: string; title: string; filters: string[] };
export type ReportCatalog = { items: ReportCatalogItem[] };
export type ReportResult = {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  total: number;
  summary?: Record<string, unknown>;
};
export type ReportFilters = Record<string, string>;
export type ReportScope = { userId: number | string; roleScope: string; tenantId: number; tenantSchoolId: number };
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export const REPORT_PAGE_SIZE = 50;

// The authenticated catalog is authoritative; this only rejects malformed path segments.
export function isKnownReport(id: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id);
}

export function catalogReports(catalog?: ReportCatalog): ReportCatalogItem[] {
  return catalog?.items.filter(item => isKnownReport(item.id)) ?? [];
}

export function reportSearch(filters: ReportFilters): string {
  const search = new URLSearchParams();
  Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)).forEach(([key, value]) => {
    if (value.trim()) search.set(key, value.trim());
  });
  return search.toString();
}

export function reportParams(scope: ReportScope, filters: ReportFilters, offset: number): ReportFilters {
  return {
    ...filters,
    ...(scope.tenantSchoolId > 0 ? { schoolId: String(scope.tenantSchoolId) } : {}),
    limit: String(REPORT_PAGE_SIZE),
    offset: String(offset),
  };
}

async function reportRequest<T>(path: string): Promise<T> {
  const response = await fetch(`/api/reports/${path}`, { credentials: 'include' });
  if (!response.ok) {
    const result: unknown = await response.json().catch(() => null);
    const message = result && typeof result === 'object' && 'error' in result
      ? String(result.error) : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function useReportCatalog(scope: ReportScope, enabled: boolean) {
  const search = scope.tenantSchoolId > 0 ? `?${reportSearch({ schoolId: String(scope.tenantSchoolId) })}` : '';
  return useQuery({
    queryKey: ['reporting', scope.userId, scope.roleScope, scope.tenantId, 'catalog'],
    queryFn: () => reportRequest<ReportCatalog>(`catalog${search}`),
    enabled,
    staleTime: 30_000,
  });
}

export function useReportResult(scope: ReportScope, id: string, filters: ReportFilters, offset: number, enabled: boolean) {
  const search = reportSearch(reportParams(scope, filters, offset));
  return useQuery({
    queryKey: ['reporting', scope.userId, scope.roleScope, scope.tenantId, id, search],
    queryFn: () => reportRequest<ReportResult>(`${encodeURIComponent(id)}${search ? `?${search}` : ''}`),
    enabled: enabled && isKnownReport(id),
    staleTime: 15_000,
  });
}

function filenameFromDisposition(disposition: string | null, fallback: string): string {
  const encoded = disposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  let candidate = fallback;
  try { candidate = encoded ? decodeURIComponent(encoded) : plain ?? fallback; }
  catch { candidate = fallback; }
  const safe = candidate.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim();
  return safe || fallback;
}

export async function exportReport(scope: ReportScope, id: string, format: ExportFormat, filters: ReportFilters, offset: number): Promise<void> {
  if (!isKnownReport(id)) throw new Error('This report is not available.');
  const search = reportSearch({ ...reportParams(scope, filters, offset), format });
  const response = await fetch(`/api/reports/${encodeURIComponent(id)}/export?${search}`, { credentials: 'include' });
  if (!response.ok) {
    const result: unknown = await response.json().catch(() => null);
    throw new Error(result && typeof result === 'object' && 'error' in result ? String(result.error) : `Export failed (${response.status}).`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filenameFromDisposition(response.headers.get('Content-Disposition'), `${id}.${format}`);
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}