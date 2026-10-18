/**
 * An unconfigured school must be able to open its settings form. This is a
 * closed, read-only draft; only the existing authenticated PUT persists a key.
 */
export function admissionPortalDraft(schoolId: number) {
  return {
    school_id: schoolId, portal_key: `not-configured-${schoolId}`, is_open: false,
    academic_session_id: null, academic_term_id: null, deadline: null,
    fee_info: null, requirements: [], required_documents: [], instructions: null,
    entrance_examination: null, interview_information: null,
    public_description: null, public_address: null, public_phone: null,
    public_email: null, logo_object_path: null,
  };
}
