import { createHash } from "node:crypto";

export const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const MANIFEST_VERSION = "production-test-tenants-preflight-v1";

// Only school-scoped rows in these tables are candidates. This is NOT executable
// deletion SQL. All other tables/rows are retained, including unknown new tables.
export const CANDIDATE_TABLES = Object.freeze([
  "academic_assessment_types", "academic_grading_rules", "academic_sessions",
  "academic_terms", "academic_timetable_entries", "attendance_settings",
  "class_subjects", "employees", "library_authors", "library_categories",
  "library_publishers", "library_settings", "library_staff",
  "maintenance_requests", "operational_tasks", "parents",
  "school_calendar_events", "school_classes", "school_facilities",
  "school_operation_categories", "school_operations_settings", "schools",
  "security_locations", "security_school_settings", "security_staff_grants",
  "student_behaviour_configurations", "student_care_grants",
  "student_identification_policies", "students", "subjects",
  "teacher_class_assignments", "teacher_duty_roster", "teacher_subject_assignments",
  "transport_buses", "transport_route_staff", "transport_route_stops",
  "transport_routes", "transport_school_policies",
]);

export const EXCLUSIONS = Object.freeze([
  "All app_users and school_memberships: preserve Owner/admin access and every auth binding.",
  "All audit, financial, subscription, payment, allocation, settlement, refund, commission and payout records.",
  "Published academic evidence, attendance/security events, care records and history tables.",
  "All NFC/card/device inventory, credentials, bindings and assignment history; no test-assignment override exists.",
  "All communication queues, receipts, templates, preferences, push subscriptions and Telegram state.",
  "All curriculum/imports, stored files, logos, provider recipients and reusable platform assets.",
  "Global/company settings, users, rules, secrets, environment, provider/webhook configuration and external auth.",
  "Schema, indexes, constraints, functions, views, triggers, migration ledger and sequence definitions/positions.",
  "Every unlisted table and every row outside the explicit selected school IDs.",
]);

export function schoolIds(value) {
  if (typeof value !== "string" || !/^[1-9]\d*(,[1-9]\d*)*$/.test(value)) {
    throw new Error("EXPLICIT_POSITIVE_SCHOOL_IDS_REQUIRED");
  }
  const ids = [...new Set(value.split(",").map(Number))].sort((a, b) => a - b);
  if (ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id > 2147483647)) {
    throw new Error("SCHOOL_ID_SCOPE_OUT_OF_RANGE");
  }
  return ids;
}

export function dependencyOrder(foreignKeys) {
  const candidates = new Set(CANDIDATE_TABLES);
  const parents = new Map(CANDIDATE_TABLES.map(name => [name, new Set()]));
  const inbound = new Map(CANDIDATE_TABLES.map(name => [name, 0]));
  for (const fk of foreignKeys) {
    if (!candidates.has(fk.child) || !candidates.has(fk.parent)) continue;
    if (!parents.get(fk.child).has(fk.parent)) {
      parents.get(fk.child).add(fk.parent);
      inbound.set(fk.parent, inbound.get(fk.parent) + 1);
    }
  }
  const ready = [...candidates].filter(name => inbound.get(name) === 0).sort();
  const order = [];
  while (ready.length) {
    const child = ready.shift();
    order.push(child);
    for (const parent of parents.get(child)) {
      inbound.set(parent, inbound.get(parent) - 1);
      if (inbound.get(parent) === 0) { ready.push(parent); ready.sort(); }
    }
  }
  return {
    order,
    unresolved: CANDIDATE_TABLES.filter(name => !order.includes(name)),
  };
}
