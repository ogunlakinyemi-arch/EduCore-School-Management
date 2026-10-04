/** Read-only creation preview; a retry in the same form retains the suffix. */
export function schoolCodePreview(name: string, suffix: string) {
  const prefix = name.trim().replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'EDU';
  return `${prefix}-${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()}`;
}