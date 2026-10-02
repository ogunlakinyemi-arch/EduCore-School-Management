import {
  createCommunicationProviders,
  type CommunicationProviderAdapters,
  type ProviderFailureCategory,
  type ProviderSendResult,
} from "./communication-providers";

export type CommunicationCategory =
  | "ATTENDANCE"
  | "ACADEMIC"
  | "ASSIGNMENT"
  | "FINANCE"
  | "PAYMENT"
  | "ANNOUNCEMENT"
  | "ACCOUNT"
  | "SYSTEM"
  | "SUBSCRIPTION"
  | "PARTNER"
  | "SECURITY";

export type CommunicationDeliveryChannel = "IN_APP" | "SMS" | "EMAIL" | "PUSH";

/**
 * Structural pg client contract. Queue callers pass their existing transaction
 * client; this service never begins, commits, or rolls back that transaction.
 */
export interface CommunicationQueryClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount?: number | null }>;
}

export interface QueueCommunicationNotificationInput {
  recipientUserId: number;
  schoolId: number | null;
  subjectStudentId?: number | null;
  subjectClassId?: number | null;
  category: CommunicationCategory;
  eventKey: string | null;
  subject: string | null;
  body: string;
  link: string | null;
  channels: CommunicationDeliveryChannel[];
}

export interface DomainParentEventInput {
  schoolId: number;
  studentId: number;
  eventType: string;
  eventId: string | number;
  category: Extract<
    CommunicationCategory,
    "ATTENDANCE" | "ACADEMIC" | "ASSIGNMENT" | "FINANCE" | "PAYMENT" | "ANNOUNCEMENT" | "SECURITY" | "SYSTEM"
  >;
  subject: string;
  body: string;
  /** GENERIC discards subject/body details that must remain private to school staff. */
  privacy?: "PARENT_SAFE" | "GENERIC";
  link?: string | null;
  channels?: Array<Extract<CommunicationDeliveryChannel, "IN_APP" | "SMS" | "EMAIL">>;
}

/**
 * Emits one notification per currently-linked parent for a single child event.
 * The caller owns the database transaction; this helper never commits or
 * dispatches providers. The event key includes the event, child and recipient.
 */
export async function emitDomainParentEvent(
  client: CommunicationQueryClient,
  input: DomainParentEventInput,
): Promise<Array<{ parentUserId: number; notificationId: number | null }>> {
  if (!Number.isSafeInteger(input.schoolId) || input.schoolId < 1
    || !Number.isSafeInteger(input.studentId) || input.studentId < 1) {
    throw new TypeError("schoolId and studentId must be positive integers.");
  }
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(input.eventType)
    || !/^[A-Za-z0-9:._-]{1,128}$/.test(String(input.eventId))) {
    throw new TypeError("eventType and eventId must be stable event identifiers.");
  }
  if (!input.subject.trim() || input.subject.length > 500
    || !input.body.trim() || input.body.length > 10_000) {
    throw new TypeError("Parent event subject/body are invalid.");
  }
  const channels: Array<Extract<CommunicationDeliveryChannel, "IN_APP" | "SMS" | "EMAIL">> =
    [...new Set(input.channels ?? ["IN_APP" as const])];
  if (channels.length === 0 || channels.some(channel => !["IN_APP", "SMS", "EMAIL"].includes(channel))) {
    throw new TypeError("Parent event channels must be IN_APP, SMS or EMAIL.");
  }

  const parents = await client.query<{
    parentUserId: number | string;
    studentName: string;
    subjectClassId: number | string | null;
  }>(
    `SELECT DISTINCT ON (p.user_id) p.user_id AS "parentUserId",
       concat_ws(' ',st.first_name,st.last_name) AS "studentName",
       current_enrollment.school_class_id AS "subjectClassId"
     FROM students st
     JOIN parents p ON p.school_id=st.school_id AND p.status='ACTIVE' AND p.user_id IS NOT NULL
     JOIN parent_student_relationships rel
       ON rel.parent_id=p.id AND rel.student_id=st.id AND rel.status='ACTIVE'
     JOIN app_users u ON u.id=p.user_id AND u.status='ACTIVE'
     LEFT JOIN student_class_assignments current_enrollment
       ON current_enrollment.student_id=st.id AND current_enrollment.school_id=st.school_id
       AND current_enrollment.status='ACTIVE' AND current_enrollment.is_current=true
     LEFT JOIN school_classes class
       ON class.id=current_enrollment.school_class_id AND class.school_id=current_enrollment.school_id
       AND class.section=current_enrollment.section
     WHERE st.id=$1 AND st.school_id=$2 AND LOWER(st.status)='active'
       AND NOT EXISTS (
         SELECT 1 FROM school_memberships owner_role
         WHERE owner_role.user_id=u.id AND owner_role.school_id IS NULL
           AND owner_role.role='PLATFORM_OWNER' AND owner_role.status='ACTIVE'
       )
     ORDER BY p.user_id,p.id`,
    [input.studentId, input.schoolId],
  );
  const results: Array<{ parentUserId: number; notificationId: number | null }> = [];
  for (const parent of parents.rows) {
    const parentUserId = Number(parent.parentUserId);
    if (!Number.isSafeInteger(parentUserId) || parentUserId < 1) continue;
    const childName = parent.studentName?.trim() || "Your child";
    const subject = input.privacy === "GENERIC"
      ? "Your child's school has an important update"
      : input.subject;
    const body = input.privacy === "GENERIC"
      ? "Please contact the school through the Communication Centre for more information."
      : input.body;
    const notificationId = await queueCommunicationNotification(client, {
      recipientUserId: parentUserId,
      schoolId: input.schoolId,
      subjectStudentId: input.studentId,
      subjectClassId: parent.subjectClassId == null ? null : Number(parent.subjectClassId),
      category: input.category,
      eventKey: `PARENT_EVENT:${input.eventType}:${input.eventId}:${input.studentId}:${parentUserId}`,
      subject: `${childName} — ${subject}`,
      body: `${childName} — ${body}`,
      link: input.link ?? null,
      channels,
    });
    results.push({ parentUserId, notificationId });
  }
  return results;
}

const categories = new Set<CommunicationCategory>([
  "ATTENDANCE",
  "ACADEMIC",
  "ASSIGNMENT",
  "FINANCE",
  "PAYMENT",
  "ANNOUNCEMENT",
  "ACCOUNT",
  "SYSTEM",
  "SUBSCRIPTION",
  "PARTNER",
  "SECURITY",
]);

const channels = new Set<CommunicationDeliveryChannel>(["IN_APP", "SMS", "EMAIL", "PUSH"]);
const mandatoryCategories = new Set<CommunicationCategory>(["ACCOUNT", "SECURITY"]);
const templateVariables = new Set([
  "student_name",
  "parent_name",
  "school_name",
  "class_name",
  "amount",
  "invoice_number",
  "payment_date",
  "attendance_date",
  "term_name",
  "assignment_title",
]);
const maximumAttempts = 5;
const maximumBackoffMs = 6 * 60 * 60 * 1000;
const staleClaimMs = 15 * 60 * 1000;

function validateNotificationInput(input: QueueCommunicationNotificationInput): void {
  if (!Number.isSafeInteger(input.recipientUserId) || input.recipientUserId < 1) {
    throw new TypeError("recipientUserId must be a positive integer.");
  }
  if (input.schoolId !== null && (!Number.isSafeInteger(input.schoolId) || input.schoolId < 1)) {
    throw new TypeError("schoolId must be null or a positive integer.");
  }
  for (const [name, id] of [
    ["subjectStudentId", input.subjectStudentId],
    ["subjectClassId", input.subjectClassId],
  ] as const) {
    if (id != null && (!Number.isSafeInteger(id) || id < 1)) {
      throw new TypeError(`${name} must be null or a positive integer.`);
    }
    if (id != null && input.schoolId === null) {
      throw new TypeError(`${name} requires a school-scoped notification.`);
    }
  }
  if (!categories.has(input.category)) {
    throw new TypeError("category is not a supported communication category.");
  }
  if (input.eventKey !== null && (typeof input.eventKey !== "string" || input.eventKey.length > 256)) {
    throw new TypeError("eventKey must be null or at most 256 characters.");
  }
  if (input.subject !== null && (typeof input.subject !== "string" || input.subject.length > 500)) {
    throw new TypeError("subject must be null or at most 500 characters.");
  }
  if (typeof input.body !== "string" || input.body.trim().length === 0 || input.body.length > 10_000) {
    throw new TypeError("body must contain 1 to 10,000 characters.");
  }
  if (input.link !== null && (
    typeof input.link !== "string"
    || !input.link.startsWith("/")
    || input.link.startsWith("//")
    || /[\r\n]/.test(input.link)
    || input.link.length > 2_000
  )) {
    throw new TypeError("link must be a safe, relative application path.");
  }
  if (!Array.isArray(input.channels) || input.channels.some(channel => !channels.has(channel))) {
    throw new TypeError("channels contains an unsupported communication channel.");
  }
}

const activeSchoolRecipientSql = `
  SELECT u.id
  FROM app_users u
  WHERE u.id = $1
    AND UPPER(u.status) = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1
      FROM school_memberships owner_role
      WHERE owner_role.user_id = u.id
        AND owner_role.school_id IS NULL
        AND owner_role.role = 'PLATFORM_OWNER'
        AND UPPER(owner_role.status) = 'ACTIVE'
    )
    AND (
      $2::integer IS NULL
      OR EXISTS (
        SELECT 1
        FROM school_memberships sm
        WHERE sm.user_id = u.id AND sm.school_id = $2 AND UPPER(sm.status) = 'ACTIVE'
        UNION ALL
        SELECT 1
        FROM students st
        WHERE st.user_id = u.id AND st.school_id = $2 AND UPPER(st.status) = 'ACTIVE'
        UNION ALL
         SELECT 1
         FROM parents p
         JOIN parent_student_relationships psr
           ON psr.parent_id = p.id AND UPPER(psr.status) = 'ACTIVE'
         JOIN students child
           ON child.id = psr.student_id
          AND child.school_id = p.school_id
          AND UPPER(child.status) = 'ACTIVE'
         WHERE p.user_id = u.id AND p.school_id = $2 AND UPPER(p.status) = 'ACTIVE'
      )
    )
`;

const subjectStudentRecipientSql = `
  SELECT subject.id
  FROM students subject
  WHERE subject.id = $1
    AND subject.school_id = $2
    AND UPPER(subject.status) = 'ACTIVE'
    AND (
      subject.user_id = $3
      OR EXISTS (
        SELECT 1
        FROM parent_student_relationships psr
        JOIN parents p ON p.id = psr.parent_id
        WHERE psr.student_id = subject.id
          AND p.user_id = $3
          AND p.school_id = subject.school_id
          AND UPPER(p.status) = 'ACTIVE'
          AND UPPER(psr.status) = 'ACTIVE'
      )
    )
`;

const subjectClassSchoolSql = `
  SELECT sc.id
  FROM school_classes sc
  WHERE sc.id = $1
    AND sc.school_id = $2
    AND (
      $3::integer IS NULL
      OR EXISTS (
        SELECT 1
        FROM students enrolled
        WHERE enrolled.id = $3
          AND enrolled.school_id = sc.school_id
          AND enrolled.class_name = sc.name
          AND enrolled.section = sc.section
          AND UPPER(enrolled.status) = 'ACTIVE'
      )
    )
`;

/**
 * Persists one notification and its per-channel delivery intents. For duplicate
 * event keys the existing notification is reused and missing channel intents
 * are added idempotently. Provider sends never happen in this function.
 */
export async function queueCommunicationNotification(
  client: CommunicationQueryClient,
  input: QueueCommunicationNotificationInput,
): Promise<number | null> {
  validateNotificationInput(input);

  const recipient = await client.query<{ id: number | string }>(
    activeSchoolRecipientSql,
    [input.recipientUserId, input.schoolId],
  );
  if (!recipient.rows.length) return null;

  if (input.subjectStudentId != null) {
    const studentAuthorization = await client.query<{ id: number | string }>(
      subjectStudentRecipientSql,
      [input.subjectStudentId, input.schoolId, input.recipientUserId],
    );
    if (!studentAuthorization.rows.length) return null;
  }
  if (input.subjectClassId != null) {
    const classAuthorization = await client.query<{ id: number | string }>(
      subjectClassSchoolSql,
      [input.subjectClassId, input.schoolId, input.subjectStudentId ?? null],
    );
    if (!classAuthorization.rows.length) return null;
  }

  const insertSql = input.schoolId === null
    ? `INSERT INTO communication_notifications
        (recipient_user_id, school_id, subject_student_id, subject_class_id, category, event_key, subject, body, link)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (event_key, recipient_user_id)
         WHERE school_id IS NULL AND event_key IS NOT NULL
       DO NOTHING
       RETURNING id`
    : `INSERT INTO communication_notifications
        (recipient_user_id, school_id, subject_student_id, subject_class_id, category, event_key, subject, body, link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (school_id, event_key, recipient_user_id)
         WHERE school_id IS NOT NULL AND event_key IS NOT NULL
       DO NOTHING
       RETURNING id`;
  const insertValues = input.schoolId === null
    ? [
      input.recipientUserId,
      input.subjectStudentId ?? null,
      input.subjectClassId ?? null,
      input.category,
      input.eventKey,
      input.subject,
      input.body,
      input.link,
    ]
    : [
      input.recipientUserId,
      input.schoolId,
      input.subjectStudentId ?? null,
      input.subjectClassId ?? null,
      input.category,
      input.eventKey,
      input.subject,
      input.body,
      input.link,
    ];
  const inserted = await client.query<{ id: number | string }>(insertSql, insertValues);
  let notificationId = inserted.rows[0]?.id;

  if (notificationId === undefined) {
    if (input.eventKey === null) return null;
    const existing = await client.query<{
      id: number | string;
      subjectStudentId: number | string | null;
      subjectClassId: number | string | null;
    }>(
      `SELECT
         id,
         subject_student_id AS "subjectStudentId",
         subject_class_id AS "subjectClassId"
       FROM communication_notifications
       WHERE recipient_user_id = $1
         AND school_id IS NOT DISTINCT FROM $2::integer
         AND event_key = $3
       ORDER BY id
       LIMIT 1`,
      [input.recipientUserId, input.schoolId, input.eventKey],
    );
    const existingNotification = existing.rows[0];
    if (
      existingNotification
      && (
        Number(existingNotification.subjectStudentId ?? 0) !== Number(input.subjectStudentId ?? 0)
        || Number(existingNotification.subjectClassId ?? 0) !== Number(input.subjectClassId ?? 0)
      )
    ) {
      return null;
    }
    notificationId = existingNotification?.id;
  }
  if (notificationId === undefined) return null;

  const requestedChannels = [...new Set(input.channels)];
  if (requestedChannels.length === 0) return Number(notificationId);

  let enabledChannels = requestedChannels;
  if (!mandatoryCategories.has(input.category)) {
    const preferences = await client.query<{
      channel: CommunicationDeliveryChannel;
      enabled: boolean;
    }>(
      `SELECT DISTINCT ON (channel) channel, enabled
       FROM communication_preferences
       WHERE user_id = $1
         AND category = $2
         AND (school_id = $3 OR school_id IS NULL)
       ORDER BY channel, CASE WHEN school_id = $3 THEN 0 ELSE 1 END`,
      [input.recipientUserId, input.category, input.schoolId],
    );
    const preferenceByChannel = new Map(preferences.rows.map(row => [row.channel, row.enabled]));
    enabledChannels = requestedChannels.filter(channel => preferenceByChannel.get(channel) !== false);
  }

  for (const channel of enabledChannels) {
    if (channel === "IN_APP") {
      await client.query(
        `INSERT INTO communication_deliveries
           (notification_id, channel, status, sent_at, next_attempt_at)
         VALUES ($1, 'IN_APP', 'SENT', NOW(), NOW())
         ON CONFLICT (notification_id, channel) DO NOTHING`,
        [notificationId],
      );
    } else {
      await client.query(
        `INSERT INTO communication_deliveries
           (notification_id, channel, status, next_attempt_at)
         VALUES ($1, $2, 'QUEUED', NOW())
         ON CONFLICT (notification_id, channel) DO NOTHING`,
        [notificationId, channel],
      );
    }
  }
  return Number(notificationId);
}

export type TemplateValues = Readonly<Record<string, string | number | null | undefined>>;

export interface CommunicationTemplateSource {
  body: string;
  subject?: string | null;
  allowedVariables?: readonly string[];
}

export interface RenderCommunicationTemplateOptions {
  escapeHtml?: boolean;
}

export class CommunicationTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommunicationTemplateError";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTemplateText(
  template: string,
  values: TemplateValues,
  allowedVariables: ReadonlySet<string>,
  shouldEscapeHtml: boolean,
): string {
  const tokens = [...template.matchAll(/{{\s*([^{}]+?)\s*}}/g)];
  const tokenNames = new Set(tokens.map(match => match[1]));
  const residue = template.replace(/{{\s*[^{}]+?\s*}}/g, "");
  if (residue.includes("{{") || residue.includes("}}")) {
    throw new CommunicationTemplateError("Template contains an invalid placeholder.");
  }
  for (const token of tokenNames) {
    if (!templateVariables.has(token) || !allowedVariables.has(token)) {
      throw new CommunicationTemplateError(`Template variable "${token}" is not allowed.`);
    }
    if (!Object.hasOwn(values, token)) {
      throw new CommunicationTemplateError(`Template variable "${token}" has no value.`);
    }
    const value = values[token];
    if (value !== null && value !== undefined && !["string", "number"].includes(typeof value)) {
      throw new CommunicationTemplateError(`Template variable "${token}" must be plain text.`);
    }
  }
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, token: string) => {
    const raw = values[token];
    const value = raw === null || raw === undefined ? "" : String(raw);
    return shouldEscapeHtml ? escapeHtml(value) : value;
  });
}

export function renderCommunicationTemplate(
  template: string,
  values: TemplateValues,
  allowedVariables?: readonly string[],
  options?: RenderCommunicationTemplateOptions,
): string;
export function renderCommunicationTemplate(
  template: CommunicationTemplateSource,
  values: TemplateValues,
  options?: RenderCommunicationTemplateOptions,
): { subject: string | null; body: string };
export function renderCommunicationTemplate(
  template: string | CommunicationTemplateSource,
  values: TemplateValues,
  allowedVariablesOrOptions: readonly string[] | RenderCommunicationTemplateOptions = [...templateVariables],
  options: RenderCommunicationTemplateOptions = {},
): string | { subject: string | null; body: string } {
  if (typeof template === "string") {
    const allowed = Array.isArray(allowedVariablesOrOptions)
      ? allowedVariablesOrOptions
      : [...templateVariables];
    const renderOptions = Array.isArray(allowedVariablesOrOptions)
      ? options
      : allowedVariablesOrOptions as RenderCommunicationTemplateOptions;
    return renderTemplateText(
      template,
      values,
      new Set(allowed),
      renderOptions.escapeHtml === true,
    );
  }

  const renderOptions = Array.isArray(allowedVariablesOrOptions)
    ? options
    : allowedVariablesOrOptions as RenderCommunicationTemplateOptions;
  const allowed = new Set(template.allowedVariables ?? [...templateVariables]);
  return {
    subject: template.subject == null
      ? null
      : renderTemplateText(template.subject, values, allowed, renderOptions.escapeHtml === true),
    body: renderTemplateText(template.body, values, allowed, renderOptions.escapeHtml === true),
  };
}

export interface CommunicationDispatchPool extends CommunicationQueryClient {
  connect(): Promise<CommunicationQueryClient & { release(): void }>;
}

export interface DispatchCommunicationOptions {
  /** Injected providers are primarily useful to isolated tests and explicit workers. */
  providers?: CommunicationProviderAdapters;
  /** External adapters require an explicit opt-in; defaults always simulate. */
  allowConfiguredProviders?: boolean;
  now?: () => Date;
  maxAttempts?: number;
}

export interface DispatchCommunicationResult {
  claimed: number;
  accepted: number;
  simulated: number;
  delivered: number;
  failed: number;
  skipped: number;
}

interface ClaimedDelivery {
  id: number | string;
  channel: "SMS" | "EMAIL";
  attempts: number;
}

interface DispatchRecord {
  id: number | string;
  channel: "SMS" | "EMAIL";
  notificationId: number | string;
  recipientUserId: number | string;
  schoolId: number | string | null;
  subjectStudentId: number | string | null;
  subjectClassId: number | string | null;
  category: CommunicationCategory;
  eventKey: string | null;
  subject: string | null;
  body: string;
  email: string | null;
  phone: string | null;
  schoolAuthorized: boolean;
  userStatus: string;
}

interface ProviderOutcome {
  result: ProviderSendResult;
  safeError: string | null;
  retryable: boolean;
  ambiguous: boolean;
}

function retryDelayMs(attempt: number): number {
  return Math.min(30_000 * (2 ** Math.max(0, attempt - 1)), maximumBackoffMs);
}

function normalizedDate(value: Date): string {
  return value.toISOString();
}

function failureText(category: ProviderFailureCategory): string {
  return `Provider delivery failed (${category.toLowerCase().replaceAll("_", " ")}).`;
}

async function claimCommunicationDeliveries(
  pool: CommunicationDispatchPool,
  batchLimit: number,
  maxAttempts: number,
  now: Date,
): Promise<ClaimedDelivery[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE communication_deliveries
       SET status = 'FAILED',
           error_code = 'PROVIDER_OUTCOME_UNKNOWN',
           last_error = 'Worker stopped while provider acceptance was unknown; manual reconciliation is required.',
           failed_at = $1,
           updated_at = $1
       WHERE channel IN ('SMS','EMAIL')
         AND status = 'PROCESSING'
          AND COALESCE(last_attempt_at, updated_at, created_at) < $1::timestamptz - INTERVAL '15 minutes'`,
      [normalizedDate(now)],
    );
    const claimed = await client.query<ClaimedDelivery>(
      `WITH due AS (
         SELECT id
         FROM communication_deliveries
         WHERE channel IN ('SMS','EMAIL')
           AND attempts < $2
           AND next_attempt_at <= $3
            AND status IN ('QUEUED','FAILED')
            AND error_code IS DISTINCT FROM 'PROVIDER_OUTCOME_UNKNOWN'
         ORDER BY next_attempt_at, created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE communication_deliveries d
       SET status = 'PROCESSING',
           attempts = d.attempts + 1,
           last_attempt_at = $3,
           error_code = NULL,
           last_error = NULL,
           updated_at = $3
       FROM due
       WHERE d.id = due.id
       RETURNING d.id, d.channel, d.attempts`,
      [batchLimit, maxAttempts, normalizedDate(now)],
    );
    await client.query("COMMIT");
    return claimed.rows;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original claim error.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function loadDispatchRecord(
  pool: CommunicationDispatchPool,
  deliveryId: number | string,
): Promise<DispatchRecord | null> {
  const result = await pool.query<DispatchRecord>(
    `SELECT
       d.id,
       d.channel,
       n.id AS "notificationId",
       n.recipient_user_id AS "recipientUserId",
       n.school_id AS "schoolId",
       n.subject_student_id AS "subjectStudentId",
       n.subject_class_id AS "subjectClassId",
       n.category,
       n.event_key AS "eventKey",
       n.subject,
       n.body,
       u.email,
       COALESCE(NULLIF(u.phone, ''), NULLIF(p.phone, '')) AS phone,
         (
           NOT EXISTS (
             SELECT 1 FROM school_memberships owner_role
             WHERE owner_role.user_id = u.id
               AND owner_role.school_id IS NULL
               AND owner_role.role = 'PLATFORM_OWNER'
               AND UPPER(owner_role.status) = 'ACTIVE'
           )
           AND (
             (
               n.school_id IS NULL
               AND n.subject_student_id IS NULL
               AND n.subject_class_id IS NULL
             )
             OR (
            n.school_id IS NOT NULL
            AND
           LOWER(COALESCE(s.status, '')) = 'active'
           AND (
             EXISTS (
               SELECT 1 FROM school_memberships sm
               WHERE sm.user_id = u.id
                 AND sm.school_id = n.school_id
                 AND UPPER(sm.status) = 'ACTIVE'
             )
             OR EXISTS (
               SELECT 1 FROM students st
               WHERE st.user_id = u.id
                 AND st.school_id = n.school_id
                 AND UPPER(st.status) = 'ACTIVE'
             )
              OR EXISTS (
                SELECT 1
                FROM parents pa
                JOIN parent_student_relationships parent_rel
                  ON parent_rel.parent_id = pa.id AND UPPER(parent_rel.status) = 'ACTIVE'
                JOIN students parent_child
                  ON parent_child.id = parent_rel.student_id
                 AND parent_child.school_id = n.school_id
                 AND UPPER(parent_child.status) = 'ACTIVE'
                WHERE pa.user_id = u.id
                  AND pa.school_id = n.school_id
                  AND UPPER(pa.status) = 'ACTIVE'
             )
           )
            AND (
              n.subject_student_id IS NULL
              OR EXISTS (
                SELECT 1
                FROM students subject
                WHERE subject.id = n.subject_student_id
                  AND subject.school_id = n.school_id
                  AND UPPER(subject.status) = 'ACTIVE'
                  AND (
                    subject.user_id = u.id
                    OR EXISTS (
                      SELECT 1
                      FROM parent_student_relationships subject_rel
                      JOIN parents subject_parent
                        ON subject_parent.id = subject_rel.parent_id
                       AND subject_parent.school_id = n.school_id
                       AND UPPER(subject_parent.status) = 'ACTIVE'
                      WHERE subject_rel.student_id = subject.id
                        AND subject_parent.user_id = u.id
                        AND UPPER(subject_rel.status) = 'ACTIVE'
                    )
                  )
                  AND (
                    n.subject_class_id IS NULL
                    OR EXISTS (
                      SELECT 1
                      FROM school_classes subject_class
                      WHERE subject_class.id = n.subject_class_id
                        AND subject_class.school_id = n.school_id
                        AND subject.class_name = subject_class.name
                        AND subject.section = subject_class.section
                    )
                  )
              )
            )
            AND (
              n.subject_class_id IS NULL
              OR EXISTS (
                SELECT 1
                FROM school_classes target_class
                JOIN students enrolled
                  ON enrolled.school_id = target_class.school_id
                 AND enrolled.class_name = target_class.name
                 AND enrolled.section = target_class.section
                 AND UPPER(enrolled.status) = 'ACTIVE'
                WHERE target_class.id = n.subject_class_id
                  AND target_class.school_id = n.school_id
                  AND (
                    enrolled.user_id = u.id
                    OR EXISTS (
                      SELECT 1
                      FROM parent_student_relationships class_rel
                      JOIN parents class_parent
                        ON class_parent.id = class_rel.parent_id
                       AND class_parent.school_id = n.school_id
                       AND UPPER(class_parent.status) = 'ACTIVE'
                      WHERE class_rel.student_id = enrolled.id
                        AND class_parent.user_id = u.id
                        AND UPPER(class_rel.status) = 'ACTIVE'
                    )
                  )
              )
            )
             )
           )
       ) AS "schoolAuthorized",
       u.status AS "userStatus"
     FROM communication_deliveries d
     JOIN communication_notifications n ON n.id = d.notification_id
     JOIN app_users u ON u.id = n.recipient_user_id
     LEFT JOIN schools s ON s.id = n.school_id
     LEFT JOIN parents p
       ON p.user_id = u.id AND p.school_id = n.school_id AND UPPER(p.status) = 'ACTIVE'
     WHERE d.id = $1 AND d.status = 'PROCESSING'`,
    [deliveryId],
  );
  return result.rows[0] ?? null;
}

async function persistProviderOutcome(
  pool: CommunicationDispatchPool,
  record: DispatchRecord,
  attempt: number,
  outcome: ProviderOutcome,
  now: Date,
  maxAttempts: number,
): Promise<void> {
  const result = outcome.result;
  const simulated = result.status === "SIMULATED";
  const delivered = result.delivered || result.status === "DELIVERED";
  const accepted = result.accepted || result.status === "ACCEPTED";
  const providerSucceeded = delivered || accepted || simulated;
  const category = result.failure?.category;
  const ambiguous = !providerSucceeded && (
    outcome.ambiguous
    || category === undefined
    || category === "NETWORK"
    || category === "TIMEOUT"
    || category === "UNKNOWN"
  );
  const willRetry = !providerSucceeded && !ambiguous && outcome.retryable && attempt < maxAttempts;
  const nextAttemptAt = willRetry
    ? new Date(now.getTime() + retryDelayMs(attempt))
    : now;
  const providerName = result.provider.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 64) || "provider";
  const lastError = simulated
    ? `${providerName}: simulated delivery; no external message was sent.`
    : ambiguous
      ? "Provider outcome is unknown; manual reconciliation is required before retry."
    : outcome.safeError;
  const attempts = !providerSucceeded && !willRetry ? maxAttempts : null;

  await pool.query(
    `UPDATE communication_deliveries
     SET status = $2,
         provider_message_id = $3,
         provider_acknowledged_at = CASE WHEN $4 THEN $5 ELSE NULL END,
         sent_at = CASE WHEN $6 OR $7 THEN $5 ELSE NULL END,
         delivered_at = CASE WHEN $7 THEN $5 ELSE NULL END,
         failed_at = CASE WHEN $8 THEN $5 ELSE NULL END,
         error_code = $9,
         last_error = $10,
         attempts = CASE WHEN $11::integer IS NULL THEN attempts ELSE $11 END,
         next_attempt_at = $12,
         updated_at = $5
     WHERE id = $1 AND status = 'PROCESSING'`,
    [
      record.id,
      delivered || accepted || simulated ? (delivered ? "DELIVERED" : "SENT") : "FAILED",
      result.providerMessageId ?? null,
      accepted,
      normalizedDate(now),
      accepted,
      delivered,
      !accepted && !delivered && !simulated && !willRetry,
      simulated ? "SIMULATED" : ambiguous ? "PROVIDER_OUTCOME_UNKNOWN" : category ?? "UNKNOWN",
      lastError,
      attempts,
      normalizedDate(nextAttemptAt),
    ],
  );
}

/**
 * Claims due SMS/email delivery intents, commits the claim before contacting
 * providers, then revalidates the user and tenant immediately before each send.
 * The default provider configuration is always no-network simulation. Real
 * providers require explicit `allowConfiguredProviders: true` or injection.
 */
export async function dispatchCommunicationDeliveries(
  pool: CommunicationDispatchPool,
  batchLimit = 50,
  options: DispatchCommunicationOptions = {},
): Promise<DispatchCommunicationResult> {
  if (!Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > 500) {
    throw new TypeError("batchLimit must be an integer from 1 to 500.");
  }
  const maxAttempts = options.maxAttempts ?? maximumAttempts;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new TypeError("maxAttempts must be an integer from 1 to 20.");
  }
  const providers = options.providers ?? createCommunicationProviders(
    options.allowConfiguredProviders === true ? process.env : {},
  );
  const now = options.now ?? (() => new Date());
  const claimed = await claimCommunicationDeliveries(pool, batchLimit, maxAttempts, now());
  const summary: DispatchCommunicationResult = {
    claimed: claimed.length,
    accepted: 0,
    simulated: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
  };

  for (const delivery of claimed) {
    const record = await loadDispatchRecord(pool, delivery.id);
    if (!record || record.channel !== delivery.channel || record.userStatus.toUpperCase() !== "ACTIVE" || !record.schoolAuthorized) {
      await pool.query(
        `UPDATE communication_deliveries
         SET status = 'CANCELLED',
             error_code = 'RECIPIENT_UNAUTHORIZED',
             last_error = 'Recipient is no longer active or authorized for this school.',
             updated_at = $2
         WHERE id = $1 AND status = 'PROCESSING'`,
        [delivery.id, normalizedDate(now())],
      );
      summary.skipped += 1;
      continue;
    }

    const target = delivery.channel === "SMS" ? record.phone : record.email;
    if (!target?.trim()) {
      await pool.query(
        `UPDATE communication_deliveries
         SET status = 'FAILED',
             attempts = $2,
             error_code = 'RECIPIENT_ADDRESS_MISSING',
             last_error = 'Recipient has no address for this delivery channel.',
             failed_at = $3,
             updated_at = $3
         WHERE id = $1 AND status = 'PROCESSING'`,
        [delivery.id, maxAttempts, normalizedDate(now())],
      );
      summary.failed += 1;
      continue;
    }

    let outcome: ProviderOutcome;
    try {
      const providerResult = delivery.channel === "SMS"
        ? await providers.sms.send({
          to: target,
          body: record.body,
          idempotencyKey: `communication-${record.notificationId}-sms`,
        })
        : await providers.email.send({
          to: target,
          subject: record.subject ?? record.category,
          body: record.body,
          idempotencyKey: `communication-${record.notificationId}-email`,
        });
      outcome = {
        result: providerResult,
        safeError: providerResult.failure
          ? failureText(providerResult.failure.category)
          : providerResult.status === "SIMULATED"
            ? "Development provider simulated this delivery; no external message was sent."
            : null,
        retryable: providerResult.failure?.retryable === true,
        ambiguous: providerResult.failure?.category === "NETWORK"
          || providerResult.failure?.category === "TIMEOUT"
          || providerResult.failure?.category === "UNKNOWN"
          || (providerResult.status === "FAILED" && providerResult.failure === undefined),
      };
    } catch {
      outcome = {
        result: {
          provider: delivery.channel === "SMS" ? providers.sms.provider : providers.email.provider,
          channel: delivery.channel === "SMS" ? "sms" : "email",
          status: "FAILED",
          accepted: false,
          delivered: false,
          failure: { category: "UNKNOWN", retryable: true },
        },
        safeError: "Delivery adapter failed unexpectedly.",
        retryable: false,
        ambiguous: true,
      };
    }

    await persistProviderOutcome(pool, record, Number(delivery.attempts), outcome, now(), maxAttempts);
    if (outcome.result.status === "SIMULATED") summary.simulated += 1;
    else if (outcome.result.delivered || outcome.result.status === "DELIVERED") summary.delivered += 1;
    else if (outcome.result.accepted || outcome.result.status === "ACCEPTED") summary.accepted += 1;
    else summary.failed += 1;
  }
  return summary;
}