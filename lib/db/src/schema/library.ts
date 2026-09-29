import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { appUsers, schools, students } from "./edupulse";

export const libraryAuthors = pgTable(
  "library_authors",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    name: text("name").notNull(),
    reference: text("reference"),
    createdByUserId: integer("created_by_user_id").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("library_authors_name_check", sql`length(btrim(${table.name})) BETWEEN 1 AND 200`),
    unique("library_authors_school_id_unique").on(table.schoolId, table.id),
    uniqueIndex("library_authors_school_name_unique").on(table.schoolId, sql`lower(${table.name})`),
  ],
);

export const libraryPublishers = pgTable(
  "library_publishers",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    name: text("name").notNull(),
    reference: text("reference"),
    createdByUserId: integer("created_by_user_id").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("library_publishers_name_check", sql`length(btrim(${table.name})) BETWEEN 1 AND 200`),
    unique("library_publishers_school_id_unique").on(table.schoolId, table.id),
    uniqueIndex("library_publishers_school_name_unique").on(table.schoolId, sql`lower(${table.name})`),
  ],
);

export const libraryCategories = pgTable(
  "library_categories",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("library_categories_name_check", sql`length(btrim(${table.name})) BETWEEN 1 AND 100`),
    unique("library_categories_school_id_unique").on(table.schoolId, table.id),
    uniqueIndex("library_categories_school_name_unique").on(table.schoolId, sql`lower(${table.name})`),
  ],
);

export const libraryBooks = pgTable(
  "library_books",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    isbn: text("isbn"),
    authorId: integer("author_id"),
    publisherId: integer("publisher_id"),
    categoryId: integer("category_id"),
    publicationYear: integer("publication_year"),
    edition: text("edition"),
    subject: text("subject"),
    description: text("description"),
    coverReference: text("cover_reference"),
    language: text("language").notNull().default("English"),
    shelfLocation: text("shelf_location"),
    status: text("status").notNull().default("ACTIVE"),
    createdByUserId: integer("created_by_user_id").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("library_books_title_check", sql`length(btrim(${table.title})) BETWEEN 1 AND 300`),
    check("library_books_publication_year_check", sql`
      ${table.publicationYear} IS NULL OR ${table.publicationYear} BETWEEN 1000 AND 2200
    `),
    check("library_books_status_check", sql`${table.status} IN ('ACTIVE','ARCHIVED')`),
    unique("library_books_school_id_unique").on(table.schoolId, table.id),
    foreignKey({
      columns: [table.authorId, table.schoolId],
      foreignColumns: [libraryAuthors.id, libraryAuthors.schoolId],
      name: "library_books_author_school_fk",
    }),
    foreignKey({
      columns: [table.publisherId, table.schoolId],
      foreignColumns: [libraryPublishers.id, libraryPublishers.schoolId],
      name: "library_books_publisher_school_fk",
    }),
    foreignKey({
      columns: [table.categoryId, table.schoolId],
      foreignColumns: [libraryCategories.id, libraryCategories.schoolId],
      name: "library_books_category_school_fk",
    }),
    index("library_books_school_search_idx").on(table.schoolId, table.status, sql`lower(${table.title})`),
    index("library_books_isbn_idx").on(table.schoolId, table.isbn).where(sql`${table.isbn} IS NOT NULL`),
  ],
);

export const libraryBookCopies = pgTable(
  "library_book_copies",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull(),
    bookId: integer("book_id").notNull(),
    copyCode: text("copy_code").notNull(),
    barcode: text("barcode"),
    condition: text("condition").notNull().default("GOOD"),
    status: text("status").notNull().default("AVAILABLE"),
    location: text("location"),
    acquiredOn: date("acquired_on", { mode: "string" }),
    acquisitionReference: text("acquisition_reference"),
    createdByUserId: integer("created_by_user_id").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("library_book_copies_code_check", sql`length(btrim(${table.copyCode})) BETWEEN 1 AND 100`),
    check("library_book_copies_condition_check", sql`${table.condition} IN ('NEW','GOOD','FAIR','POOR')`),
    check("library_book_copies_status_check", sql`
      ${table.status} IN ('AVAILABLE','BORROWED','RESERVED','LOST','DAMAGED','MAINTENANCE','RETIRED')
    `),
    unique("library_book_copies_school_id_unique").on(table.schoolId, table.id),
    unique("library_book_copies_school_book_id_unique").on(table.schoolId, table.bookId, table.id),
    foreignKey({
      columns: [table.bookId, table.schoolId],
      foreignColumns: [libraryBooks.id, libraryBooks.schoolId],
      name: "library_book_copies_book_school_fk",
    }),
    uniqueIndex("library_book_copies_school_code_unique")
      .on(table.schoolId, sql`lower(${table.copyCode})`),
    uniqueIndex("library_book_copies_school_barcode_unique")
      .on(table.schoolId, table.barcode)
      .where(sql`${table.barcode} IS NOT NULL`),
    index("library_book_copies_available_idx").on(table.schoolId, table.bookId, table.status),
  ],
);

export const librarySettings = pgTable(
  "library_settings",
  {
    schoolId: integer("school_id").primaryKey().references(() => schools.id),
    studentBorrowingEnabled: boolean("student_borrowing_enabled").notNull().default(true),
    teacherBorrowingEnabled: boolean("teacher_borrowing_enabled").notNull().default(false),
    staffBorrowingEnabled: boolean("staff_borrowing_enabled").notNull().default(false),
    maxBooksPerStudent: integer("max_books_per_student").notNull().default(3),
    maxBooksPerTeacher: integer("max_books_per_teacher").notNull().default(5),
    maxBooksPerStaff: integer("max_books_per_staff").notNull().default(5),
    studentLoanDays: integer("student_loan_days").notNull().default(14),
    teacherLoanDays: integer("teacher_loan_days").notNull().default(30),
    staffLoanDays: integer("staff_loan_days").notNull().default(30),
    maxRenewals: integer("max_renewals").notNull().default(1),
    renewalRequiresNotOverdue: boolean("renewal_requires_not_overdue").notNull().default(true),
    finesEnabled: boolean("fines_enabled").notNull().default(false),
    updatedByUserId: integer("updated_by_user_id").references(() => appUsers.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("library_settings_student_limit_check", sql`${table.maxBooksPerStudent} BETWEEN 1 AND 50`),
    check("library_settings_teacher_limit_check", sql`${table.maxBooksPerTeacher} BETWEEN 1 AND 50`),
    check("library_settings_staff_limit_check", sql`${table.maxBooksPerStaff} BETWEEN 1 AND 50`),
    check("library_settings_student_days_check", sql`${table.studentLoanDays} BETWEEN 1 AND 180`),
    check("library_settings_teacher_days_check", sql`${table.teacherLoanDays} BETWEEN 1 AND 180`),
    check("library_settings_staff_days_check", sql`${table.staffLoanDays} BETWEEN 1 AND 180`),
    check("library_settings_renewals_check", sql`${table.maxRenewals} BETWEEN 0 AND 20`),
    check("library_settings_fines_disabled_check", sql`${table.finesEnabled} = false`),
  ],
);

export const libraryStaff = pgTable(
  "library_staff",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    userId: integer("user_id").notNull().references(() => appUsers.id),
    canManageCatalogue: boolean("can_manage_catalogue").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    assignedByUserId: integer("assigned_by_user_id").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("library_staff_school_id_unique").on(table.schoolId, table.id),
    unique("library_staff_school_user_unique").on(table.schoolId, table.userId),
    index("library_staff_school_active_idx").on(table.schoolId, table.isActive),
  ],
);

export const libraryLoans = pgTable(
  "library_loans",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull(),
    bookId: integer("book_id").notNull(),
    copyId: integer("copy_id").notNull(),
    borrowerType: text("borrower_type").notNull(),
    borrowerUserId: integer("borrower_user_id").notNull().references(() => appUsers.id),
    borrowerStudentId: integer("borrower_student_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnedOverdue: boolean("returned_overdue"),
    daysOverdueAtReturn: integer("days_overdue_at_return"),
    status: text("status").notNull().default("OPEN"),
    issuedByUserId: integer("issued_by_user_id").notNull().references(() => appUsers.id),
    returnedByUserId: integer("returned_by_user_id").references(() => appUsers.id),
    renewalCount: integer("renewal_count").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("library_loans_borrower_type_check", sql`${table.borrowerType} IN ('STUDENT','TEACHER','STAFF')`),
    check("library_loans_status_check", sql`${table.status} IN ('OPEN','RETURNED','LOST')`),
    check("library_loans_renewal_count_check", sql`${table.renewalCount} >= 0`),
    check("library_loans_days_overdue_check", sql`
      ${table.daysOverdueAtReturn} IS NULL OR ${table.daysOverdueAtReturn} >= 0
    `),
    check("library_loans_borrower_student_check", sql`
      (${table.borrowerType} = 'STUDENT' AND ${table.borrowerStudentId} IS NOT NULL) OR
      (${table.borrowerType} IN ('TEACHER','STAFF') AND ${table.borrowerStudentId} IS NULL)
    `),
    check("library_loans_returned_state_check", sql`
      (${table.status}='RETURNED' AND ${table.returnedAt} IS NOT NULL AND ${table.returnedByUserId} IS NOT NULL
        AND ${table.returnedOverdue} IS NOT NULL AND ${table.daysOverdueAtReturn} IS NOT NULL)
      OR (${table.status}<>'RETURNED' AND ${table.returnedAt} IS NULL AND ${table.returnedByUserId} IS NULL
        AND ${table.returnedOverdue} IS NULL AND ${table.daysOverdueAtReturn} IS NULL)
    `),
    unique("library_loans_school_id_unique").on(table.schoolId, table.id),
    foreignKey({
      columns: [table.bookId, table.schoolId],
      foreignColumns: [libraryBooks.id, libraryBooks.schoolId],
      name: "library_loans_book_school_fk",
    }),
    foreignKey({
      columns: [table.schoolId, table.bookId, table.copyId],
      foreignColumns: [libraryBookCopies.schoolId, libraryBookCopies.bookId, libraryBookCopies.id],
      name: "library_loans_copy_book_school_fk",
    }),
    foreignKey({
      columns: [table.borrowerStudentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "library_loans_student_school_fk",
    }),
    uniqueIndex("library_loans_school_idempotency_unique")
      .on(table.schoolId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex("library_loans_open_copy_unique")
      .on(table.schoolId, table.copyId)
      .where(sql`${table.status} = 'OPEN'`),
    index("library_loans_borrower_history_idx")
      .on(table.schoolId, table.borrowerUserId, table.issuedAt.desc()),
    index("library_loans_overdue_idx").on(table.schoolId, table.dueOn).where(sql`${table.status} = 'OPEN'`),
  ],
);

export const libraryRenewals = pgTable(
  "library_renewals",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull(),
    loanId: integer("loan_id").notNull(),
    renewedByUserId: integer("renewed_by_user_id").notNull().references(() => appUsers.id),
    previousDueOn: date("previous_due_on", { mode: "string" }).notNull(),
    newDueOn: date("new_due_on", { mode: "string" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("library_renewals_school_loan_key_unique").on(table.schoolId, table.loanId, table.idempotencyKey),
    foreignKey({
      columns: [table.loanId, table.schoolId],
      foreignColumns: [libraryLoans.id, libraryLoans.schoolId],
      name: "library_renewals_loan_school_fk",
    }),
    index("library_renewals_loan_history_idx").on(table.schoolId, table.loanId, table.createdAt),
  ],
);

export const libraryCopyStatusHistory = pgTable(
  "library_copy_status_history",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull(),
    copyId: integer("copy_id").notNull(),
    loanId: integer("loan_id"),
    previousStatus: text("previous_status").notNull(),
    newStatus: text("new_status").notNull(),
    reason: text("reason").notNull(),
    notes: text("notes"),
    changedByUserId: integer("changed_by_user_id").notNull().references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("library_copy_status_history_new_status_check", sql`
      ${table.newStatus} IN ('AVAILABLE','BORROWED','RESERVED','LOST','DAMAGED','MAINTENANCE','RETIRED')
    `),
    check("library_copy_status_history_reason_check", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
    foreignKey({
      columns: [table.copyId, table.schoolId],
      foreignColumns: [libraryBookCopies.id, libraryBookCopies.schoolId],
      name: "library_copy_status_history_copy_school_fk",
    }),
    foreignKey({
      columns: [table.loanId, table.schoolId],
      foreignColumns: [libraryLoans.id, libraryLoans.schoolId],
      name: "library_copy_status_history_loan_school_fk",
    }),
    index("library_copy_status_history_idx").on(table.schoolId, table.copyId, table.createdAt.desc()),
  ],
);

export const insertLibraryAuthorSchema = createInsertSchema(libraryAuthors).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLibraryPublisherSchema = createInsertSchema(libraryPublishers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLibraryCategorySchema = createInsertSchema(libraryCategories).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLibraryBookSchema = createInsertSchema(libraryBooks).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLibraryBookCopySchema = createInsertSchema(libraryBookCopies).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLibrarySettingsSchema = createInsertSchema(librarySettings)
  .omit({ updatedAt: true })
  .extend({ finesEnabled: z.literal(false).optional() });
export const insertLibraryStaffSchema = createInsertSchema(libraryStaff).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLibraryLoanSchema = createInsertSchema(libraryLoans).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLibraryRenewalSchema = createInsertSchema(libraryRenewals).omit({ id: true, createdAt: true });
export const insertLibraryCopyStatusHistorySchema = createInsertSchema(libraryCopyStatusHistory).omit({ id: true, createdAt: true });

export type LibraryAuthor = typeof libraryAuthors.$inferSelect;
export type InsertLibraryAuthor = z.infer<typeof insertLibraryAuthorSchema>;
export type LibraryPublisher = typeof libraryPublishers.$inferSelect;
export type InsertLibraryPublisher = z.infer<typeof insertLibraryPublisherSchema>;
export type LibraryCategory = typeof libraryCategories.$inferSelect;
export type InsertLibraryCategory = z.infer<typeof insertLibraryCategorySchema>;
export type LibraryBook = typeof libraryBooks.$inferSelect;
export type InsertLibraryBook = z.infer<typeof insertLibraryBookSchema>;
export type LibraryBookCopy = typeof libraryBookCopies.$inferSelect;
export type InsertLibraryBookCopy = z.infer<typeof insertLibraryBookCopySchema>;
export type LibrarySettings = typeof librarySettings.$inferSelect;
export type InsertLibrarySettings = z.infer<typeof insertLibrarySettingsSchema>;
export type LibraryStaff = typeof libraryStaff.$inferSelect;
export type InsertLibraryStaff = z.infer<typeof insertLibraryStaffSchema>;
export type LibraryLoan = typeof libraryLoans.$inferSelect;
export type InsertLibraryLoan = z.infer<typeof insertLibraryLoanSchema>;
export type LibraryRenewal = typeof libraryRenewals.$inferSelect;
export type InsertLibraryRenewal = z.infer<typeof insertLibraryRenewalSchema>;
export type LibraryCopyStatusHistory = typeof libraryCopyStatusHistory.$inferSelect;
export type InsertLibraryCopyStatusHistory = z.infer<typeof insertLibraryCopyStatusHistorySchema>;