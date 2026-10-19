import { expect, it } from 'vitest';
import { personPhotoSource } from './person-photo-source';
const uuid = '11111111-1111-4111-8111-111111111111';
it.each(['student', 'employee'] as const)('routes %s photos only through a matching protected read', kind => {
  const endpoint = `/api/${kind === 'student' ? 'students' : 'employees'}/12/photo?schoolId=3`;
  expect(personPhotoSource(kind, 3, 12, `/objects/${kind}-photos/3/12/${uuid}`)).toBe(endpoint);
  expect(personPhotoSource(kind, 3, 12, endpoint)).toBe(endpoint);
  for (const value of [null, '', 'https://example.test/photo.png', `/objects/${kind}-photos/4/12/${uuid}`, `/objects/${kind}-photos/3/13/${uuid}`, '/api/students/13/photo?schoolId=3']) {
    expect(personPhotoSource(kind, 3, 12, value)).toBeNull();
  }
});
