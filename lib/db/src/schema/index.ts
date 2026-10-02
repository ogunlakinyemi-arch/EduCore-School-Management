// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

export * from "./edupulse";
export * from "./phase6";
export * from "./finance";
export * from "./communication";
export * from "./library";
export * from "./operations";
export * from "./staff-nfc-billing";
export * from "./employee-nfc";
export * from "./school-workflows";
export * from "./transport";
export * from "./settlement-payroll";
export * from "./student-subscription-billing";
export * from "./curriculum-learning";
export * from "./admissions-expansion";
export * from "./student-care-expansion";
export * from "./promotion-expansion";
export * from "./school-security-core";
export * from "./school-security-operations";