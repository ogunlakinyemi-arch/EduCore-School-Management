/** Public, source-reviewed guidance only. Never include account or school data. */
export type HelpAudience = 'schools' | 'partners' | 'teachers-staff';
export type HelpSection = {
  id: string; title: string; summary: string; steps: string[];
  notes?: string[]; links?: { label: string; href: string }[]; appliesTo?: string;
};
export type HelpManual = {
  id: HelpAudience; title: string; subtitle: string; audienceLabel: string; sections: HelpSection[];
};
export const helpReviewed = '25 October 2026';

const security: HelpSection = {
  id: 'security-support', title: 'Account security and getting help',
  summary: 'Protect school records and report problems without sharing private information.',
  steps: [
    'Use your own sign-in account. Never share a password, verification code, invitation token, NFC credentials or payment-provider keys.',
    'Sign out before leaving a shared computer. Check the account and school shown before entering or changing information.',
    'For a missing role, class or school, contact your School Admin. BROs should contact their organisation owner or the Yetenia representative who onboarded the organisation.',
    'For an unresolved platform problem, ask that contact to escalate to the Platform Owner. Include the screen name, time in WAT, what you expected, and the visible error message.',
    'If a reference is needed for a payment investigation, send it only through your established private support channel. Crop or redact screenshots: no student names, full account numbers, passwords or verification codes.',
  ],
  notes: ['No public support phone number or email is verified in this guide. Use your established school or Yetenia contact; do not send documents to an address guessed from the brand name.'],
  links: [{ label: 'Sign in', href: '/sign-in' }],
};
const access: HelpSection = {
  id: 'access', title: 'Registration, invitations and sign-in',
  summary: 'An account type selection does not grant access. Your approved membership controls the portal.',
  steps: [
    'New School Admins and Business Relationship Officers (BRO) can start at Apply. Use the application type that describes your actual responsibility and complete the information requested on the form.',
    'Sign in or create the account when prompted, submit the application, and check its status on the application page. Operational access requires Platform Owner approval.',
    'If you received an invitation, open the supplied invitation link and follow the acceptance instructions using the intended account. Do not make a second application just to replace an invitation.',
    'Returning users should open Sign in and use an offered sign-in method. If asked to choose a portal, choose a role already assigned to you.',
    'If access is pending or a portal is unavailable, use the displayed status or retry access check. Ask your administrator to check the membership; selecting another account type cannot add permissions.',
  ],
  links: [{ label: 'Apply as a School Admin or BRO', href: '/apply' }, { label: 'Sign in', href: '/sign-in' }],
};

export const helpManuals: HelpManual[] = [
  {
    id: 'schools', audienceLabel: 'Schools / School Admins', title: 'School Admin setup manual',
    subtitle: 'Set up your school, organise records and run day-to-day school work.',
    sections: [
      access,
      {
        id: 'school-navigation', title: 'Find your way around', summary: 'Work in the correct school and use the pages available to your role.',
        steps: [
          'After sign-in, open your school dashboard. Where a school selector is shown, confirm the school before working.',
          'Use the navigation sections to open school records, academics, attendance and finance. On a phone, open the menu in the header; close it after choosing a page.',
          'Start with Academic Calendar and school Settings to review the school context. Use School Branding for school identity used by supported documents.',
          'Use Users & Roles and Employees for authorised access and employee administration. Grant only the duties each person needs.',
        ],
        notes: ['A Platform Owner oversight view is not the same as School Admin permission to perform ordinary school operations. Menu items and actions depend on active roles and school permissions.'],
        links: [{ label: 'School dashboard', href: '/' }, { label: 'Academic Calendar', href: '/academic-calendar' }, { label: 'School Settings', href: '/settings' }, { label: 'School Branding', href: '/school-branding' }, { label: 'Users & Roles', href: '/users' }],
      },
      {
        id: 'people-classes', title: 'Classes, students and parents', summary: 'Create a usable school roster and check the relationships before continuing.',
        steps: [
          'Review Classes and the class or section structure before assigning students.',
          'Open Students to add or review student details and the correct class. Use Parents to maintain parent or guardian records and check the correct child relationships.',
          'Use Employees for teacher and staff records. Use Teacher Assignments for class and subject responsibility; employment alone does not assign a teaching class.',
          'Review saved records before proceeding. A school roster entry is not proof that an invited user has accepted an account or that an NFC card is active.',
        ],
        links: [{ label: 'Classes', href: '/classes' }, { label: 'Students', href: '/students' }, { label: 'Parents', href: '/parents' }, { label: 'Employees', href: '/employees' }, { label: 'Teacher Assignments', href: '/teacher-assignments' }],
      },
      {
        id: 'imports', title: 'Import existing records', summary: 'Import Records supports students, parents, teachers and staff with a review before confirmation.',
        steps: [
          'Open Import Records and select the intended school and record type. Download the CSV template for that type rather than copying a different roster format.',
          'Prepare a small, clean file first. The importer accepts CSV, XLSX and supported tabular PDFs; a file that cannot be read must be corrected rather than assumed imported.',
          'Upload the file, inspect the detected columns and map them to the requested fields. For student imports, map class values to the intended school classes.',
          'Generate and review the preview. Resolve invalid rows and check duplicates or potential duplicates before confirming the selected rows.',
          'Read the imported, skipped and failed summary. Check the relevant roster after import; correct failed rows rather than uploading everything repeatedly.',
        ],
        notes: ['Keep source files private and share only with authorised staff. Import is not a substitute for checking parent relationships, account access or NFC readiness.'],
        links: [{ label: 'Import Records', href: '/people/imports' }],
      },
      {
        id: 'attendance-nfc', title: 'Attendance and NFC readiness', summary: 'Attendance records, card administration and physical reader readiness are separate checks.',
        steps: [
          'Open Attendance and select the school day or history range. Review recorded events and discrepancies; use Record event only when your role permits and the details are accurate.',
          'Use Schedule to review school attendance timing and the controls available to the school.',
          'Use NFC Cards for student card administration and Employee NFC for employee cards. New student card assignment or activation depends on the school having a linked reader and passing the displayed checks.',
          'If a reader, card or assignment is not ready, record the visible blocker and contact the responsible administrator. Platform device management is not a School Admin task.',
        ],
        notes: ['A card printout does not create or activate a card. A tag-in is a recorded event, not biometric identity verification or proof of the student’s current location. Hardware delivery, connectivity and authorisation must be confirmed separately.'],
        links: [{ label: 'Attendance', href: '/attendance' }, { label: 'Schedule', href: '/attendance/schedule' }, { label: 'NFC Cards', href: '/cards' }, { label: 'Employee NFC', href: '/employee-nfc' }],
      },
      {
        id: 'academics', title: 'Academics, assessment and published results', summary: 'Set the academic context and assignments before teachers enter results.',
        steps: [
          'Review Academics, Subjects and the Academic Calendar for the correct session and term. Check Teacher Assignments and Timetable.',
          'Use Academic Work for the assessment and assignment work available in your school. Use Curriculum and Lesson Notes for the assigned instructional workflow.',
          'Open Exam/Record to review submitted subjects, preview report cards and use the available review and publication actions.',
          'Check the correct student, class, term, scores and remarks before publishing. Family access depends on the appropriate publication; saving a draft does not publish it.',
          'For a published correction, follow the correction and review workflow shown on the screen. Review and republish the corrected report rather than assuming that a score edit alone updates family access.',
        ],
        links: [{ label: 'Academics', href: '/academics' }, { label: 'Academic Work', href: '/academic-work' }, { label: 'Lesson Notes', href: '/lesson-notes' }, { label: 'Exam/Record', href: '/exam-record' }, { label: 'Timetable', href: '/timetable' }],
      },
      {
        id: 'school-finance', title: 'Finance, settlement and subscriptions', summary: 'Use the school finance screens without treating setup or TEST evidence as real payment.',
        steps: [
          'Use Finance for school fee administration and Finance Workspace for the authorised finance workflow. Check the school, student and payment reference before recording any financial action.',
          'In Payment Settlement, choose a bank from the searchable provider directory. The automatic code must come from the selected provider record; do not type a bank name or invent a routing code.',
          'If the catalogue is unavailable or the entry is unverified, retry the directory or contact your administrator. Saving new transfer-enabled bank details requires current provider-code confirmation.',
          'Where the LIVE onboarding section is present, submitting saved school details requests verification. Owner review, provider permission, release approval and independent readback are separate prerequisites; this guide does not activate them.',
          'Review Subscriptions and staff NFC finance statuses as applicable. Check the displayed mode and confirmed status; a callback, screenshot, pending checkout or TEST success is not proof of LIVE payment or settlement.',
        ],
        notes: ['LIVE_VERIFIED bank onboarding does not enable checkout. Do not repeatedly retry an uncertain payment or subaccount creation; ask for reconciliation using the existing reference. This manual makes no change to allocations, fees, commissions or LIVE enablement.'],
        links: [{ label: 'Finance', href: '/finance' }, { label: 'Finance Workspace', href: '/finance-workspace' }, { label: 'Payment Settlement', href: '/payment-settlement' }, { label: 'Subscriptions', href: '/subscriptions' }, { label: 'Staff NFC Finance', href: '/staff-nfc-finance' }],
      },
      security,
    ],
  },
  {
    id: 'partners', audienceLabel: 'Business Relationship Officers (BRO)', title: 'Business Relationship Officer (BRO) setup manual',
    subtitle: 'Onboard your organisation, register schools and understand commission records.',
    sections: [
      access,
      {
        id: 'partner-navigation', title: 'Your BRO dashboard and permissions', summary: 'The BRO portal is separate from a school’s operational portal.',
        steps: [
          'Open the BRO dashboard after your membership is approved. If the profile is not ready, contact the administrator rather than creating duplicate accounts.',
          'Use Schools to see the organisation’s schools. The header also exposes reporting and inbox; on phones use the navigation links below the header.',
          'Organisation owners or BRO Admins can manage the Staff and Settings areas. Commissions and Payouts are shown only to users with the required finance access.',
          'Do not use a BRO account to perform a School Admin’s academic or school-finance work. An additional role must be assigned separately if required.',
        ],
        links: [{ label: 'BRO dashboard', href: '/partner' }, { label: 'Schools', href: '/partner/schools' }, { label: 'BRO Settings — owner/admin', href: '/partner/profile' }],
      },
      {
        id: 'school-registration', title: 'Register or refer a school', summary: 'Use the BRO school-registration workflow and track its status.',
        steps: [
          'From the BRO dashboard or Schools, open Add School. Enter the actual school and intended School Admin details requested by the form.',
          'Review the information and submit using the action offered by the page. Track the school and invitation status in Schools.',
          'Where a referral or invitation link is offered, use that generated link. Do not edit tokens, invent a referral code or promise access before acceptance and approval checks are complete.',
          'Ask the intended School Admin to follow their own invitation. If the invitation fails or the result is uncertain, ask the organisation owner or Platform Owner to reconcile it before repeating registration.',
        ],
        notes: ['A registered or referred school does not automatically authorise every BRO employee to access it, earn a commission or activate its cards.'],
        links: [{ label: 'Add School', href: '/partner/schools/add' }, { label: 'My schools', href: '/partner/schools' }],
      },
      {
        id: 'commissions-payouts', title: 'Commissions, payout records and bank settings', summary: 'Distinguish recorded entitlement, approval and confirmed payment.',
        appliesTo: 'BRO owners/admins and finance-authorised members; settings require owner/admin access.',
        steps: [
          'Open Commissions to review the records and statuses available to your organisation. Deferred commission totals are not the same as money already paid.',
          'Open Payouts to inspect recorded payout status and references. Do not mark a payment complete from a screenshot or TEST result.',
          'Organisation owners or admins use Settings to maintain permitted profile and payout information. For bank transfer details, select a provider from the directory and use its automatic confirmed code.',
          'If the directory is unavailable or a provider has no verified code, retry or escalate. Do not substitute another institution’s code to make the form save.',
          'For a commission or payout discrepancy, report the relevant record/reference privately to your organisation owner for escalation. Do not create a second school or payment to force another commission.',
        ],
        notes: ['Eligible BRO subscription commission is an internal accrued liability with a separate review/payment process, not an automatic third recipient in the collection split. A bank-directory listing is not payout approval.'],
        links: [{ label: 'Commissions', href: '/partner/commissions' }, { label: 'Payouts', href: '/partner/payouts' }, { label: 'BRO Settings', href: '/partner/profile' }],
      },
      {
        id: 'partner-nfc', title: 'Staff NFC and approved activation duties', summary: 'Use NFC-related BRO screens only within the access granted to the organisation.',
        steps: [
          'Use Staff NFC Commissions to inspect the records available to your membership.',
          'NFC Activation appears only when BRO NFC access is granted. Follow the available school-specific checks and Owner-approved scope.',
          'If activation is not available, ask the Platform Owner to review eligibility. Do not change a device, create a financial approval or assume a commission record grants activation permission.',
        ],
        notes: ['Reader hardware, school access and financial authority are separate. BRO activation access does not grant device management or payment authority.'],
        links: [{ label: 'Staff NFC Commissions', href: '/partner/staff-nfc' }, { label: 'NFC Activation — approved members only', href: '/partner/nfc-activation' }],
      },
      security,
    ],
  },
  {
    id: 'teachers-staff', audienceLabel: 'Teachers / Staff', title: 'Teacher and staff setup manual',
    subtitle: 'Join your school, find assigned work and use your own employee services.',
    sections: [
      {
        id: 'employee-access', title: 'Join your school and sign in', summary: 'Teachers and staff use school-assigned access, not a public Teacher/Staff application.',
        steps: [
          'Ask your School Admin to create or check your employee record and the intended user membership. The public application form is for School Admins and Business Relationship Officers (BRO).',
          'If invited, open your own invitation link and complete acceptance with the intended account. Then sign in through the normal sign-in page.',
          'Check the school and role shown on the dashboard. If no membership is available, ask your School Admin to check it; choosing Teacher or Staff at sign-in cannot grant the role.',
          'On a phone, open the menu to find available work. Menu visibility and editing depend on your active duties, not the job title alone.',
        ],
        links: [{ label: 'Sign in', href: '/sign-in' }],
      },
      {
        id: 'employee-roster', title: 'Students, classes and attendance', summary: 'Use authorised school views without assuming roster-management permission.',
        steps: [
          'Use Classes and Students to review the records made available to your role. Ask the School Admin to correct enrolment, parent relationships or missing classes.',
          'Open Attendance and choose the intended school day or history range. Review events and discrepancies; record or correct an event only if the screen grants that action.',
          'If a card scan is missing, report the time, relevant school and reader context through your school’s private process. Do not assume a tag-in proves current location or biometric identity.',
        ],
        notes: ['Teachers and staff do not acquire student/parent administration or device-management rights by reading this guide. NFC scans require separately configured cards and readers.'],
        links: [{ label: 'Classes', href: '/classes' }, { label: 'Students', href: '/students' }, { label: 'Attendance', href: '/attendance' }],
      },
      {
        id: 'teacher-academics', title: 'Teaching work, assessment and results', summary: 'Teaching pages require a Teacher role and the appropriate assignments.',
        appliesTo: 'Teachers; not a general Staff entitlement.',
        steps: [
          'Review Teacher Assignments and Timetable. If Exam/Record says no classes are assigned, ask the School Admin to assign the correct class and subject before entering marks.',
          'Use Curriculum, Lesson Notes and Academic Work for the instructional tasks available to your assignments. Confirm the session and term before saving.',
          'In Exam/Record, open an assigned class and subject, enter and review the required scores or comments, then use the available submission action.',
          'If work is returned, review the comment and correct it before resubmitting. School Admin review and publication are separate; submitting your sheet is not publication to families.',
          'Use the question-paper surface only where offered and follow its review status. Refer published-result corrections to the School Admin rather than bypassing review.',
        ],
        links: [{ label: 'Teacher Assignments', href: '/teacher-assignments' }, { label: 'Timetable', href: '/timetable' }, { label: 'Lesson Notes', href: '/lesson-notes' }, { label: 'Academic Work', href: '/academic-work' }, { label: 'Exam/Record', href: '/exam-record' }],
      },
      {
        id: 'employee-services', title: 'Your E-ID, NFC subscription and payslips', summary: 'Employee self-service does not grant school finance or payroll administration.',
        steps: [
          'Open My Employee E-ID to review your own available card information and status. Refer missing assignments or incorrect details to your School Admin.',
          'Open My NFC Subscription to review the employee-specific status and instructions shown. Do not infer activation or real payment from a pending status or TEST evidence.',
          'Open My Payslips to view the payslips available to your own account. If a payslip is missing or incorrect, contact the school payroll administrator.',
          'Ask the authorised payroll administrator to maintain your bank details. A confirmed bank-directory code is not confirmation that salary has been transferred.',
        ],
        links: [{ label: 'My Employee E-ID', href: '/my-employee-nfc' }, { label: 'My NFC Subscription', href: '/my-nfc-subscription' }, { label: 'My Payslips', href: '/my-payslips' }],
      },
      {
        id: 'employee-duties', title: 'Messages and additional staff duties', summary: 'Use only the duties and channels assigned to you.',
        steps: [
          'Open Inbox for messages. Push, in-app and Telegram are standard channels; delivery still requires setup, consent and permission.',
          'Teachers with communication permission can use Communications. Other Staff should use the channels available to their membership and school process.',
          'Library, Operations, student care and security actions depend on role or assigned duties. If an action is absent, ask the School Admin to review access rather than using another person’s account.',
        ],
        links: [{ label: 'Inbox', href: '/inbox' }],
      },
      security,
    ],
  },
];

export const helpFaqs: { question: string; answer: string; audiences: HelpAudience[] }[] = [
  { question: 'Why is my account pending or the selected portal unavailable?', answer: 'An application, school record or portal selection is not an active membership. Check the application status or invitation, use Retry access check if offered, and ask the responsible administrator to verify the intended account and role. Do not create duplicate applications.', audiences: ['schools', 'partners', 'teachers-staff'] },
  { question: 'Why is a menu item or class missing?', answer: 'Confirm the school context first. Menu items depend on the active role and some duties require additional assignment. Teachers need class and subject assignments; Staff do not automatically have teaching or finance access. Contact your School Admin or BRO organisation owner.', audiences: ['schools', 'partners', 'teachers-staff'] },
  { question: 'The bank directory is unavailable or a transfer code is unverified. What should I do?', answer: 'Use Refresh the directory and select the exact provider record after it loads. Do not enter a free-text bank or guess a code. If it still fails, send the visible error to the administrator. Directory membership does not establish account ownership, payout permission or LIVE readiness.', audiences: ['schools', 'partners'] },
  { question: 'The importer shows invalid or duplicate records. Is anything already imported?', answer: 'Inspection and preview are review stages; confirm the intended rows only after resolving errors and checking duplicates. After confirmation, use the result summary and roster to identify imported, skipped and failed rows. Do not repeatedly import the whole file to fix one failed row.', audiences: ['schools'] },
  { question: 'Why can families not see a saved result?', answer: 'Draft, teacher-submitted, reviewed and published results are different states. Ask the School Admin to check the correct school, child relationship, session/term and publication. Published corrections require the appropriate review and republication.', audiences: ['schools', 'teachers-staff'] },
  { question: 'Does a printed NFC card or tag-in prove activation or presence?', answer: 'No. Printing does not activate or unlock a card. Card assignment, school/reader readiness and access checks are separate. A tag-in is a recorded event, not biometric identity or proof of current location. Report a missing event rather than repeatedly changing the assignment.', audiences: ['schools', 'partners', 'teachers-staff'] },
  { question: 'Does LIVE_VERIFIED mean payments are enabled?', answer: 'No. LIVE_VERIFIED onboarding indicates provider subaccount readback, not checkout enablement, successful collection or settlement. LIVE merchant evidence, release approval, financial authority and checkout configuration remain separate. Do not change payment settings just to clear a setup message.', audiences: ['schools', 'partners'] },
  { question: 'My payment or payout is pending. Should I pay again?', answer: 'Do not repeat an uncertain operation automatically. Check the mode, status and existing reference, then ask the authorised finance contact to reconcile it. TEST results, screenshots and callback redirects do not prove LIVE settlement.', audiences: ['schools', 'partners', 'teachers-staff'] },
  { question: 'How do I save a manual as a PDF on a phone or computer?', answer: 'Open the complete printable manual and select Print / Save as PDF. On a computer choose Save as PDF in the print destination. On a phone use the browser Print or Share → Print option, then save or share a PDF if your browser supports it. If there is no PDF option, open the same manual on a desktop browser. You do not need to sign in to read or print these guides.', audiences: ['schools', 'partners', 'teachers-staff'] },
];

export function findHelpManual(id: string | undefined) {
  return helpManuals.find(manual => manual.id === id);
}
