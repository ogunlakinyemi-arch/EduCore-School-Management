// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: { isPlatformOwner: false, roles: [{ role: 'SCHOOL_ADMIN', schoolId: 1, status: 'ACTIVE' }] } }),
}));
import { StudentPhotoField } from './student-photo-field';
import { EmployeePhotoField } from './employee-photo-field';

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });
it.each(['student', 'employee'])('uploads and confirms a private %s photo against its own record', async kind => {
  const table = kind === 'student' ? 'students' : 'employees';
  const objectPath = `/objects/${kind}-photos/1/10/11111111-1111-4111-8111-111111111111`;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ uploadURL: 'https://signed-upload.example/unit', objectPath }), { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const onUpdated = vi.fn();
  await act(async () => root.render(kind === 'student'
    ? <StudentPhotoField schoolId={1} studentId={10} passportUrl={null} onUpdated={onUpdated} />
    : <EmployeePhotoField schoolId={1} employeeId={10} photoUrl={null} onUpdated={onUpdated} />));
  const input = host.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['unit image'], 'photo.png', { type: 'image/png' })] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/${table}/10/photo-upload-request`);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ schoolId: 1, contentType: 'image/png' });
  expect(fetchMock.mock.calls[1][0]).toBe('https://signed-upload.example/unit');
  expect(fetchMock.mock.calls[2][0]).toBe(`/api/${table}/10/photo-confirm`);
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ schoolId: 1, objectPath });
  expect(onUpdated).toHaveBeenCalledTimes(1);
  expect(host.querySelector('img')?.getAttribute('src')).toContain(`/api/${table}/10/photo?schoolId=1&v=`);
  await act(async () => root.unmount());
});
it('does not send unsupported image types to storage', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EmployeePhotoField schoolId={1} employeeId={10} onUpdated={vi.fn()} />));
  const input = host.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [new File(['unit'], 'photo.svg', { type: 'image/svg+xml' })] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Choose a JPEG, PNG, or WebP image');
  await act(async () => root.unmount());
});
