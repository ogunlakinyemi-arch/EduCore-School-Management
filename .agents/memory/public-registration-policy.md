---
name: Public registration approval policy
description: Only School Admin and Partner applicants may publicly apply; Owner approval precedes operational access.
---

Public signup is for School Admin and Partner applicants only, not teachers,
staff, parents, students or other privileged roles. New applications must remain
pending without operational access until a Platform Owner approves them.
Owner review needs Pending, Approved and Rejected states, applicant details,
secure decisions and audit history. Approval enables the corresponding Partner
portal or School Admin school account and emails the applicant; rejection never
grants access and should email the applicant when supported.

**Why:** The user explicitly requested an Owner-reviewed application process
while preserving all existing users' roles and login access. Existing school
referral invitations are not evidence of Owner approval.

**How to apply:** Keep application review separate from existing identities,
memberships and student admissions. Enforce activation server-side, including
referral/invitation paths, rather than trusting a public role selector or hiding
portals. Do not reinterpret the policy as authorization to demote existing users.
Keep all existing roles available for login: the two-type restriction concerns
public applications, not sign-in or genuine invitation acceptance.

The user explicitly authorized additive application storage in Development on
2026-10-19, not Production migration or publishing. Report exact schema changes
and verification before seeking any separate Production/publishing approval.

Registration must collect the applicant's appropriate profile during signup,
not merely tell them to complete it later. School applicants require school name,
Admin full name and Admin phone, with school address optional. Partner applicants
require full name, email, phone and a supported Partner type, with business name
optional. Keep the pending gate and transfer submitted profile details on approval.

**Why:** The user explicitly requested these registration fields while retaining
the existing authentication provider and approval/notification workflow.

**How to apply:** Use the existing application store, validate on both sides, and
explain any strictly necessary additive schema change before applying it.
