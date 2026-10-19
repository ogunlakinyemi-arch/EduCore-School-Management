import { StudentPhotoField } from './student-photo-field';

export function EmployeePhotoField({ schoolId, employeeId, photoUrl, onUpdated }: { schoolId: number; employeeId: number; photoUrl?: string | null; onUpdated: () => void }) {
  return <StudentPhotoField kind="employee" schoolId={schoolId} studentId={employeeId} passportUrl={photoUrl} onUpdated={onUpdated} />;
}
