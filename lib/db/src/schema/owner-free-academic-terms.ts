// Unregistered REVIEW CANDIDATE. Procedural SQL/trigger delivery requires separate
// approval; exporting a model alone must not imply the feature is schema-ready.
import {date,foreignKey,integer,pgTable,serial,text,timestamp,unique} from "drizzle-orm/pg-core";
import {createInsertSchema} from "drizzle-zod";
import {schools,academicTerms,academicSessions,appUsers} from "./edupulse";
export const ownerFreeAcademicTerms=pgTable("owner_free_academic_terms",{
  id:serial("id").primaryKey(),
  schoolId:integer("school_id").notNull().references(()=>schools.id,{onDelete:"restrict"}),
  academicSessionId:integer("academic_session_id").notNull(),
  academicTermId:integer("academic_term_id").notNull(),
  startDate:date("start_date",{mode:"string"}).notNull(),
  endDate:date("end_date",{mode:"string"}).notNull(),
  actorUserId:integer("actor_user_id").notNull().references(()=>appUsers.id,{onDelete:"restrict"}),
  reason:text("reason").notNull(),status:text("status").notNull().default("TRIAL_GRANTED"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  unique().on(t.schoolId,t.academicTermId),
  foreignKey({columns:[t.academicTermId,t.schoolId],foreignColumns:[academicTerms.id,academicTerms.schoolId]}),
  foreignKey({columns:[t.academicSessionId,t.schoolId],foreignColumns:[academicSessions.id,academicSessions.schoolId]}),
]);
export const ownerFreeAcademicTermEvents=pgTable("owner_free_academic_term_events",{
  id:serial("id").primaryKey(),
  grantId:integer("grant_id").notNull().references(()=>ownerFreeAcademicTerms.id,{onDelete:"restrict"}),
  actorUserId:integer("actor_user_id").notNull().references(()=>appUsers.id,{onDelete:"restrict"}),
  status:text("status").notNull(),reason:text("reason").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[unique().on(t.grantId,t.status)]);
export const insertOwnerFreeAcademicTermSchema=createInsertSchema(ownerFreeAcademicTerms).omit({id:true,createdAt:true});
export const insertOwnerFreeAcademicTermEventSchema=createInsertSchema(ownerFreeAcademicTermEvents).omit({id:true,createdAt:true});
export type OwnerFreeAcademicTerm=typeof ownerFreeAcademicTerms.$inferSelect;
