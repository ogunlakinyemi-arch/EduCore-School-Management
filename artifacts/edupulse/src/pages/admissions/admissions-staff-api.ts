import { useMutation } from '@tanstack/react-query';
import {
  requestStaffAdmissionDocumentUpload, updateAdmissionApplicationProfile,
  type AdmissionApplicationPatchInput, type AdmissionDocumentUploadInput,
} from '@workspace/api-client-react';

export type { AdmissionApplicationPatchInput };

export function useStageStaffAdmissionDocument() {
  return useMutation({
    mutationFn: ({ schoolId, data }: { schoolId: number; data: AdmissionDocumentUploadInput }) =>
      requestStaffAdmissionDocumentUpload(data, { schoolId }),
  });
}

export function useUpdateAdmissionApplicationFields() {
  return useMutation({
    mutationFn: ({ applicationId, schoolId, data }: { applicationId: number; schoolId: number; data: AdmissionApplicationPatchInput }) =>
      updateAdmissionApplicationProfile(applicationId, data, { schoolId }),
  });
}
