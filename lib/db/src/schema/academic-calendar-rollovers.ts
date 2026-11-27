/** Candidate structure only; indexes and procedural protections require 0187. */
import {sql} from "drizzle-orm";
import {pgTable,bigserial,integer,text,date,jsonb,timestamp,index,check} from "drizzle-orm/pg-core";
import {schools} from "./edupulse";
import {sourceReference as fk,sourceKeyName as key} from "./current-finance-keys";
export const academicCalendarRollovers=pgTable("academic_calendar_rollovers",{
 id:bigserial("id",{mode:"number"}).primaryKey(),schoolId:integer("school_id").notNull(),
 effectiveDate:date("effective_date",{mode:"string"}).notNull(),
 eventKey:text("event_key").notNull().unique(key("academic_calendar_rollovers",["event_key"],"key")),
 calendarDigest:text("calendar_digest").notNull(),sourceDigest:text("source_digest").notNull(),
 result:text("result").notNull(),academicSessionId:integer("academic_session_id"),academicTermId:integer("academic_term_id"),
 changes:jsonb("changes").notNull(),issues:jsonb("issues").notNull(),calendarSnapshot:jsonb("calendar_snapshot").notNull(),
 createdAt:timestamp("created_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},t=>[
 fk("academic_calendar_rollovers",t.schoolId,schools.id),
 index("academic_calendar_rollovers_school_date").on(t.schoolId,t.effectiveDate),
 check(key("academic_calendar_rollovers",["event_key"],"check"),sql`event_key ~ '^[a-f0-9]{64}$'`),
 check(key("academic_calendar_rollovers",["calendar_digest"],"check"),sql`calendar_digest ~ '^[a-f0-9]{64}$'`),
 check(key("academic_calendar_rollovers",["source_digest"],"check"),sql`source_digest ~ '^[a-f0-9]{64}$'`),
 check(key("academic_calendar_rollovers",["result"],"check"),sql`result IN ('TRANSITIONED','BLOCKED')`),
 check(key("academic_calendar_rollovers",["changes"],"check"),sql`jsonb_typeof(changes)='array'`),
 check(key("academic_calendar_rollovers",["issues"],"check"),sql`jsonb_typeof(issues)='array'`),
 check(key("academic_calendar_rollovers",["calendar_snapshot"],"check"),sql`jsonb_typeof(calendar_snapshot)='object'`),
]);
