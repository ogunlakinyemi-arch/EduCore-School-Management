export function personPhotoSource(kind: 'student' | 'employee', schoolId: number, personId: number, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const table = kind === 'student' ? 'students' : 'employees';
  const endpoint = `/api/${table}/${personId}/photo?schoolId=${schoolId}`;
  const object = new RegExp(`^/objects/${kind}-photos/${schoolId}/${personId}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 'i');
  return object.test(value) || value === endpoint ? endpoint : null;
}
