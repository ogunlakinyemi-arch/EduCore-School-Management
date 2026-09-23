# EduPulse Platform Owner Setup

## Before the first deployment

1. Configure production Clerk keys for the EduPulse deployment.
2. Add a strong, randomly generated production secret named `EDUPULSE_SETUP_KEY`.
3. Apply the database migrations. The migrations create tenant-integrity indexes before their composite foreign keys, replace and validate `student_class_assignments_class_school_fk`, and never delete or rewrite assignment data. If mismatched historical rows exist, migration stops with an explicit count so they can be reviewed safely.
4. Deploy the API and EduPulse web artifacts.

## Create the first Platform Owner

1. Open `/setup/platform-owner` on the deployed EduPulse site.
2. Enter the owner’s full name, email, phone number, a strong password, and the exact `EDUPULSE_SETUP_KEY`.
3. Submit the form once, then sign in with the new owner account.
4. Confirm the owner can open Schools, Users & Roles, Devices, Notifications, Partners, Subscriptions, Audit Log, and Settings.

The setup endpoint uses a transaction advisory lock and permanently refuses another first-owner setup after any global `PLATFORM_OWNER` membership exists. Inactive historical owner memberships also keep setup disabled. The password is sent only to Clerk and is never written to the EduPulse database or logs.

After confirming the owner can sign in, remove `EDUPULSE_SETUP_KEY` from the production deployment. The existing owner record continues to keep setup disabled, and removing the key reduces unnecessary secret exposure.

## Create a school and its first administrator

1. Sign in as the Platform Owner.
2. Open **Schools** and create the school.
3. Select that school in the tenant picker.
4. Open **Users & Roles**, choose **Create Admin**, and enter the administrator’s name, email, phone, and a temporary strong password.
5. Share the credentials through a secure channel and ask the administrator to sign in and change the password.

School Administrators receive only a membership for their assigned school. The API returns `404` for resources in another school and rejects all Platform Owner routes.

## Recovery

- If setup reports **Setup Unavailable**, verify that `EDUPULSE_SETUP_KEY` is configured in the same environment as the API.
- If setup reports **Setup Complete**, an owner membership already exists. Do not edit or delete it to rerun setup; use the existing owner account and Clerk’s account recovery.
- Do not restore the retired `EDUPULSE_BOOTSTRAP_CLERK_USER_ID` behavior. Owner access must come only from an explicit global membership.