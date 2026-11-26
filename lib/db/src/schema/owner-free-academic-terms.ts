// Structural metadata only. Procedural SQL/trigger delivery requires separate
// approval; exporting a model alone must not imply the feature is schema-ready.
import {sql} from "drizzle-orm";
import {check,date,foreignKey,integer,pgTable,serial,text,timestamp,unique} from "drizzle-orm/pg-core";
import {createInsertSchema} from "drizzle-zod";
import {schools,academicTerms,academicSessions,appUsers} from "./edupulse";
export const ownerFreeAcademicTerms=pgTable("owner_free_academic_terms",{
  id:serial("id").primaryKey(),
  schoolId:integer("school_id").notNull(),
  academicSessionId:integer("academic_session_id").notNull(),
  academicTermId:integer("academic_term_id").notNull(),
  startDate:date("start_date",{mode:"string"}).notNull(),
  endDate:date("end_date",{mode:"string"}).notNull(),
  actorUserId:integer("actor_user_id").notNull(),
  reason:text("reason").notNull(),status:text("status").notNull().default("TRIAL_GRANTED"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  unique("owner_free_academic_terms_school_id_academic_term_id_key").on(t.schoolId,t.academicTermId),
  foreignKey({name:"owner_free_academic_terms_school_id_fkey",columns:[t.schoolId],foreignColumns:[schools.id]}).onDelete("restrict"),
  foreignKey({name:"owner_free_academic_terms_actor_user_id_fkey",columns:[t.actorUserId],foreignColumns:[appUsers.id]}).onDelete("restrict"),
  foreignKey({name:"owner_free_academic_terms_academic_term_id_school_id_fkey",columns:[t.academicTermId,t.schoolId],foreignColumns:[academicTerms.id,academicTerms.schoolId]}).onDelete("restrict"),
  foreignKey({name:"owner_free_academic_terms_academic_session_id_school_id_fkey",columns:[t.academicSessionId,t.schoolId],foreignColumns:[academicSessions.id,academicSessions.schoolId]}).onDelete("restrict"),
  check("owner_free_academic_terms_reason_check",sql`length(trim(${t.reason})) BETWEEN 5 AND 500`),
  check("owner_free_academic_terms_status_check",sql`${t.status}='TRIAL_GRANTED'`),
  check("owner_free_academic_terms_check",sql`${t.endDate}>=${t.startDate}`),
]);
export const ownerFreeAcademicTermEvents=pgTable("owner_free_academic_term_events",{
  id:serial("id").primaryKey(),
  grantId:integer("grant_id").notNull(),
  actorUserId:integer("actor_user_id").notNull(),
  status:text("status").notNull(),reason:text("reason").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  unique("owner_free_academic_term_events_grant_id_status_key").on(t.grantId,t.status),
  foreignKey({name:"owner_free_academic_term_events_grant_id_fkey",columns:[t.grantId],foreignColumns:[ownerFreeAcademicTerms.id]}).onDelete("restrict"),
  foreignKey({name:"owner_free_academic_term_events_actor_user_id_fkey",columns:[t.actorUserId],foreignColumns:[appUsers.id]}).onDelete("restrict"),
  check("owner_free_academic_term_events_status_check",sql`${t.status} IN ('TRIAL_GRANTED','SUSPENDED')`),
  check("owner_free_academic_term_events_reason_check",sql`length(trim(${t.reason})) BETWEEN 5 AND 500`),
]);
export const insertOwnerFreeAcademicTermSchema=createInsertSchema(ownerFreeAcademicTerms).omit({id:true,createdAt:true});
export const insertOwnerFreeAcademicTermEventSchema=createInsertSchema(ownerFreeAcademicTermEvents).omit({id:true,createdAt:true});
export type OwnerFreeAcademicTerm=typeof ownerFreeAcademicTerms.$inferSelect;
