import { pgTable, serial, integer, text, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appUsers, schools, partnerProfiles, partnerReferralLinks } from "./edupulse";

export const accountApplications = pgTable("account_applications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => appUsers.id),
  applicantType: text("applicant_type").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  schoolName: text("school_name"),
  businessName: text("business_name"),
  partnerType: text("partner_type"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  address: text("address"),
  referralLinkId: integer("referral_link_id").references(() => partnerReferralLinks.id),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: integer("reviewed_by").references(() => appUsers.id),
  rejectionReason: text("rejection_reason"),
  schoolId: integer("school_id").references(() => schools.id),
  partnerProfileId: integer("partner_profile_id").references(() => partnerProfiles.id),
  notificationStatus: text("notification_status").notNull().default("NOT_REQUESTED"),
}, (t) => [
  uniqueIndex("account_applications_user_unique").on(t.userId),
  uniqueIndex("account_applications_email_unique").on(sql`lower(${t.email})`),
  index("account_applications_status_created_idx").on(t.status, t.createdAt),
  check("account_applications_type_check", sql`${t.applicantType} IN ('SCHOOL_ADMIN','PARTNER')`),
  check("account_applications_partner_type_check", sql`${t.partnerType} IS NULL OR (${t.applicantType}='PARTNER' AND ${t.partnerType} IN ('BUSINESS','INDIVIDUAL'))`),
  check("account_applications_status_check", sql`${t.status} IN ('PENDING','APPROVED','REJECTED')`),
  check("account_applications_notification_check", sql`${t.notificationStatus} IN ('NOT_REQUESTED','SENDING','ACCEPTED','FAILED','UNKNOWN','UNAVAILABLE')`),
  check("account_applications_school_name_check", sql`${t.applicantType}<>'SCHOOL_ADMIN' OR length(btrim(${t.schoolName}))>=2 AND ${t.schoolName} IS NOT NULL`),
  check("account_applications_decision_check", sql`
    (${t.status}='PENDING' AND ${t.reviewedAt} IS NULL AND ${t.reviewedBy} IS NULL AND ${t.rejectionReason} IS NULL AND ${t.schoolId} IS NULL AND ${t.partnerProfileId} IS NULL)
    OR (${t.status}='REJECTED' AND ${t.reviewedAt} IS NOT NULL AND ${t.reviewedBy} IS NOT NULL AND ${t.rejectionReason} IS NOT NULL AND length(btrim(${t.rejectionReason}))>0 AND ${t.schoolId} IS NULL AND ${t.partnerProfileId} IS NULL)
    OR (${t.status}='APPROVED' AND ${t.reviewedAt} IS NOT NULL AND ${t.reviewedBy} IS NOT NULL AND ${t.rejectionReason} IS NULL AND
      ((${t.applicantType}='SCHOOL_ADMIN' AND ${t.schoolId} IS NOT NULL AND ${t.partnerProfileId} IS NULL)
       OR (${t.applicantType}='PARTNER' AND ${t.partnerProfileId} IS NOT NULL AND ${t.schoolId} IS NULL)))`),
]);
