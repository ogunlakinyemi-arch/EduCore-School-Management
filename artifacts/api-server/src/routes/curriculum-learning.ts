import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { Storage } from "@google-cloud/storage";
import { pool } from "@workspace/db";
import {
  AuthError,
  getUserContext,
  requireAuthentication,
  assertSchoolAccess,
} from "../middlewares/auth";
import { parseImportFile } from "./people-import-service";
import { queueCommunicationNotification } from "../services/communication-service";
import { lessonTeachingScope } from "../services/lesson-teaching-scope";
import { lessonPdfPaths, signLessonPdfUpload, validateLessonPdfMetadata, finalizeLessonPdf,
  lessonDocumentContext, lessonDocumentColumns, lessonPdfFile } from "../services/lesson-note-pdf";
import {
  assertCurriculumVersionMutable,
  assertLessonNoteSubmittable,
  assertRevision,
  mapCurriculumImportRows,
  transitionLessonNote,
  type LessonNoteAction,
  type LessonNoteStatus,
} from "../services/curriculum-learning-service";
import {
  asyncId,
  bodyObject,
  dateOnly,
  lessonInput,
  optionalText,
  normalizeCurriculumLabel,
  requestParam,
  requiredText,
  requireOwner,
  requireSchoolAdmin,
  requireSchoolTeacher,
  requireTeacherOrAdmin,
  run,
  schoolId,
  versionInput,
  arrays,
} from "./curriculum-learning-validation";

const router = Router();
router.use(requireAuthentication());
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    type: "external_account",
    credential_source: {
      url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function auditValues(req: Request, school: number, action: string, recordId: number) {
  const context = getUserContext(req);
  const actor = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
  const role = context.roles.find((membership) => membership.schoolId === school)?.role ?? "AUTHENTICATED";
  return [actor, role, context.user.id, context.user.clerkUserId, school, action, recordId];
}
async function audit(req: Request, school: number, action: string, recordId: number, client: any = pool) {
  await client.query(
    `INSERT INTO audit_logs ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result)
     VALUES ($1,$2,$3,$4,$5,$6,'Curriculum and Lesson Notes',$7,'info','APPLICATION_EVENT','SUCCESS')`,
    auditValues(req, school, action, recordId),
  );
}
async function auditOwner(req: Request, action: string, recordId: number, client: any = pool) {
  const context = getUserContext(req);
  const actor = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
  await client.query(
    `INSERT INTO audit_logs ("user",role,actor_user_id,clerk_user_id,action,module,record_id,severity,event_type,result)
     VALUES ($1,'PLATFORM_OWNER',$2,$3,$4,'Curriculum Library',$5,'info','APPLICATION_EVENT','SUCCESS')`,
    [actor, context.user.id, context.user.clerkUserId, action, recordId],
  );
}

async function ownerVersion(versionId: number, lock = false, client: any = pool) {
  const result = await client.query(`SELECT * FROM curriculum_versions WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [versionId]);
  if (!result.rows[0]) throw new AuthError(404, "Curriculum version not found");
  return result.rows[0];
}
async function validateTopicParent(
  client: any,
  parentIdValue: unknown,
  topicScope:
    | { versionId: number; classLevel: string; subjectCode: string }
    | { mappingId: number; schoolId: number; classLevel: string; subjectCode: string },
  editingId?: number,
) {
  if (parentIdValue == null) return null;
  const parentId = asyncId(parentIdValue,"parentTopicId");
  let sql: string;
  let values: unknown[];
  if ("versionId" in topicScope) {
    sql = `WITH RECURSIVE ancestors AS (
         SELECT id,parent_topic_id FROM curriculum_topics WHERE id=$1 AND curriculum_version_id=$2
           AND regexp_replace(lower(class_level),'[^a-z0-9]','','g')=$3
           AND regexp_replace(lower(subject_code),'[^a-z0-9]','','g')=$4
         UNION
         SELECT p.id,p.parent_topic_id FROM curriculum_topics p JOIN ancestors a ON a.parent_topic_id=p.id
          WHERE p.curriculum_version_id=$2
            AND regexp_replace(lower(p.class_level),'[^a-z0-9]','','g')=$3
            AND regexp_replace(lower(p.subject_code),'[^a-z0-9]','','g')=$4
       ) SELECT id FROM ancestors`;
    values = [parentId,topicScope.versionId,normalizeCurriculumLabel(topicScope.classLevel),normalizeCurriculumLabel(topicScope.subjectCode)];
  } else {
    sql = `WITH RECURSIVE ancestors AS (
         SELECT id,parent_topic_id FROM curriculum_topics WHERE id=$1 AND mapping_id=$2 AND school_id=$3
           AND regexp_replace(lower(class_level),'[^a-z0-9]','','g')=$4
           AND regexp_replace(lower(subject_code),'[^a-z0-9]','','g')=$5
         UNION
         SELECT p.id,p.parent_topic_id FROM curriculum_topics p JOIN ancestors a ON a.parent_topic_id=p.id
          WHERE p.mapping_id=$2 AND p.school_id=$3
            AND regexp_replace(lower(p.class_level),'[^a-z0-9]','','g')=$4
            AND regexp_replace(lower(p.subject_code),'[^a-z0-9]','','g')=$5
       ) SELECT id FROM ancestors`;
    values = [parentId,topicScope.mappingId,topicScope.schoolId,
      normalizeCurriculumLabel(topicScope.classLevel),normalizeCurriculumLabel(topicScope.subjectCode)];
  }
  const ancestors = await client.query(sql,values);
  if (!ancestors.rows.length) throw new AuthError(400,"parentTopicId must belong to the same version or school mapping, class, and subject");
  if (editingId && (parentId === editingId || ancestors.rows.some((row: any) => Number(row.id) === editingId))) {
    throw new AuthError(400,"A topic cannot be its own ancestor");
  }
  return parentId;
}

const versionColumns = `id,title,education_level AS "educationLevel",class_levels AS "classLevels",
  subject_codes AS "subjectCodes",source_kind AS "sourceKind",source_organization AS "sourceOrganization",
  source_reference AS "sourceReference",source_version AS "sourceVersion",effective_date AS "effectiveDate",
  verified_date AS "verifiedDate",description,source_document_path AS "sourceDocumentPath",
  (SELECT ci.id FROM curriculum_imports ci
     WHERE ci.confirmed_version_id=curriculum_versions.id OR
       (curriculum_versions.source_document_path IS NOT NULL AND ci.object_path=curriculum_versions.source_document_path)
     ORDER BY CASE WHEN ci.confirmed_version_id=curriculum_versions.id THEN 0 ELSE 1 END,ci.id DESC LIMIT 1) AS "sourceImportId",
  derived_from_version_id AS "derivedFromVersionId",status,created_by AS "createdBy",
  created_at AS "createdAt",published_at AS "publishedAt",archived_at AS "archivedAt"`;

const noteColumns = `n.id,n.school_id AS "schoolId",n.academic_session_id AS "sessionId",
  n.academic_term_id AS "termId",n.school_class_id AS "classId",n.subject_id AS "subjectId",
  n.teacher_employee_id AS "teacherId",n.section,n.week,n.lesson_date AS date,
  n.curriculum_mapping_id AS "curriculumMappingId",n.curriculum_version_id AS "curriculumVersionId",
  n.topic_id AS "topicId",n.sub_topic_id AS "subTopicId",n.content,n.status,n.revision,
  n.submitted_at AS "submittedAt",n.approved_at AS "approvedAt",n.created_at AS "createdAt",n.updated_at AS "updatedAt"`;
const noteReturning = `id,school_id AS "schoolId",academic_session_id AS "sessionId",
  academic_term_id AS "termId",school_class_id AS "classId",subject_id AS "subjectId",
  teacher_employee_id AS "teacherId",section,week,lesson_date AS date,
  curriculum_mapping_id AS "curriculumMappingId",curriculum_version_id AS "curriculumVersionId",
  topic_id AS "topicId",sub_topic_id AS "subTopicId",content,status,revision,
  submitted_at AS "submittedAt",approved_at AS "approvedAt",created_at AS "createdAt",updated_at AS "updatedAt"`;

async function addPinnedVersion(note: Record<string, any>,client: any = pool) {
  const documents = await client.query(`SELECT ${lessonDocumentColumns} FROM lesson_note_documents
    WHERE lesson_note_id=$1 AND school_id=$2 AND status='READY' ORDER BY id DESC`, [note.id,note.schoolId]);
  note = { ...note, documents: documents.rows };
  if (!note.curriculumVersionId) return { ...note,curriculumVersion: null };
  const result = await client.query(`SELECT ${versionColumns} FROM curriculum_versions WHERE id=$1`,[note.curriculumVersionId]);
  if (!result.rows[0]) return { ...note,curriculumVersion: null };
  const { sourceDocumentPath: _privatePath,...curriculumVersion } = result.rows[0];
  return { ...note,curriculumVersion };
}

router.get("/curriculum/versions", run(async (req, res) => {
  requireOwner(req);
  const status = req.query.status === undefined ? null : String(req.query.status);
  if (status && !["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) throw new AuthError(400, "status is invalid");
  const result = await pool.query(`SELECT ${versionColumns} FROM curriculum_versions WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC,id DESC`, [status]);
  res.json(result.rows);
}));

router.get("/schools/:schoolId/curriculum/catalog", run(async (req,res) => {
  const school = schoolId(req);
  requireSchoolAdmin(req,school);
  const classId = req.query.classId === undefined ? null : asyncId(req.query.classId,"classId");
  const subjectId = req.query.subjectId === undefined ? null : asyncId(req.query.subjectId,"subjectId");
  const applicability = classId == null && subjectId == null ? null : await pool.query(
    `SELECT c.name AS "className",s.code AS "subjectCode",s.name AS "subjectName"
       FROM school_classes c CROSS JOIN subjects s
      WHERE c.school_id=$1 AND ($2::integer IS NULL OR c.id=$2)
        AND s.school_id=$1 AND ($3::integer IS NULL OR s.id=$3)`,
    [school,classId,subjectId],
  );
  if (applicability && !applicability.rows.length) throw new AuthError(404,"School class or subject not found");
  const result = await pool.query(
    `SELECT ${versionColumns} FROM curriculum_versions
      WHERE status='PUBLISHED'
         AND ($1::text[] IS NULL OR jsonb_array_length(class_levels)=0 OR EXISTS(
           SELECT 1 FROM jsonb_array_elements_text(class_levels) level
            WHERE regexp_replace(lower(level),'[^a-z0-9]','','g')=ANY($1::text[])
         ))
         AND ($2::text[] IS NULL OR jsonb_array_length(subject_codes)=0 OR EXISTS(
           SELECT 1 FROM jsonb_array_elements_text(subject_codes) code
            WHERE regexp_replace(lower(code),'[^a-z0-9]','','g')=ANY($2::text[])
        ))
      ORDER BY effective_date DESC NULLS LAST,title,id`,
    [
      classId == null ? null : [...new Set(applicability!.rows.map((row: any) => normalizeCurriculumLabel(row.className)).filter(Boolean))],
      subjectId == null ? null : [...new Set(applicability!.rows.flatMap((row: any) =>
        [normalizeCurriculumLabel(row.subjectCode),normalizeCurriculumLabel(row.subjectName)].filter(Boolean)))],
    ],
  );
  res.json(result.rows);
}));

router.post("/curriculum/versions", run(async (req, res) => {
  const userId = requireOwner(req);
  const input = versionInput(bodyObject(req.body));
  const result = await pool.query(
    `INSERT INTO curriculum_versions(title,education_level,class_levels,subject_codes,source_kind,source_organization,
       source_reference,source_version,effective_date,verified_date,description,derived_from_version_id,created_by)
     VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING ${versionColumns}`,
    [input.title,input.educationLevel,JSON.stringify(input.classLevels),JSON.stringify(input.subjectCodes),input.sourceKind,input.sourceOrganization,
      input.sourceReference,input.sourceVersion,input.effectiveDate,input.verifiedDate,input.description,input.derivedFromVersionId,userId],
  );
  await auditOwner(req, "Created curriculum version draft", Number(result.rows[0].id));
  res.status(201).json(result.rows[0]);
}));

router.get("/curriculum/versions/:versionId", run(async (req, res) => {
  requireOwner(req);
  const versionId = requestParam(req, "versionId");
  const version = await ownerVersion(versionId);
  const topics = await pool.query(
    `SELECT id,class_level AS "classLevel",subject_code AS "subjectCode",parent_topic_id AS "parentTopicId",
            title,learning_objectives AS "learningObjectives",learning_outcomes AS "learningOutcomes",
            suggested_resources AS "suggestedResources",source_kind AS "sourceKind",sequence_order AS "sequenceOrder"
       FROM curriculum_topics WHERE curriculum_version_id=$1 ORDER BY class_level,subject_code,sequence_order,id`,
    [versionId],
  );
  const { rows } = await pool.query(`SELECT ${versionColumns} FROM curriculum_versions WHERE id=$1`, [versionId]);
  res.json({ ...rows[0], topics: topics.rows });
}));

router.patch("/curriculum/versions/:versionId", run(async (req, res) => {
  const userId = requireOwner(req);
  const versionId = requestParam(req, "versionId");
  const input = versionInput(bodyObject(req.body));
  const client = await pool.connect();
  let updated;
  try {
    await client.query("BEGIN");
    const current = await ownerVersion(versionId, true, client);
    try { assertCurriculumVersionMutable(current.status); } catch (error) { throw new AuthError(409, (error as Error).message); }
    updated = await client.query(
      `UPDATE curriculum_versions SET title=$1,education_level=$2,class_levels=$3::jsonb,subject_codes=$4::jsonb,
         source_kind=$5,source_organization=$6,source_reference=$7,source_version=$8,effective_date=$9,
         verified_date=$10,description=$11,derived_from_version_id=$12
       WHERE id=$13 RETURNING ${versionColumns}`,
      [input.title,input.educationLevel,JSON.stringify(input.classLevels),JSON.stringify(input.subjectCodes),input.sourceKind,
        input.sourceOrganization,input.sourceReference,input.sourceVersion,input.effectiveDate,input.verifiedDate,input.description,input.derivedFromVersionId,versionId],
    );
    await auditOwner(req, "Updated curriculum version draft", versionId, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.json(updated!.rows[0]);
}));

router.post("/curriculum/versions/:versionId/topics", run(async (req, res) => {
  requireOwner(req);
  const versionId = requestParam(req, "versionId");
  const body = bodyObject(req.body);
  const classLevel = requiredText(body.classLevel, "classLevel", 100);
  const subjectCode = requiredText(body.subjectCode, "subjectCode", 100);
  const objectives = arrays(body.learningObjectives, "learningObjectives");
  const outcomes = arrays(body.learningOutcomes, "learningOutcomes");
  const resources = arrays(body.suggestedResources, "suggestedResources");
  const client = await pool.connect();
  let inserted;
  try {
    await client.query("BEGIN");
    const version = await ownerVersion(versionId,true,client);
    try { assertCurriculumVersionMutable(version.status); } catch (error) { throw new AuthError(409,(error as Error).message); }
    if (Array.isArray(version.class_levels) && version.class_levels.length &&
        !version.class_levels.some((level: string) => normalizeCurriculumLabel(level) === normalizeCurriculumLabel(classLevel))) {
      throw new AuthError(400,"classLevel is outside this version's configured applicability");
    }
    const parentTopicId = await validateTopicParent(client,body.parentTopicId,{versionId,classLevel,subjectCode});
    inserted = await client.query(
      `INSERT INTO curriculum_topics(curriculum_version_id,class_level,subject_code,parent_topic_id,title,
         learning_objectives,learning_outcomes,suggested_resources,source_kind,sequence_order)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)
       RETURNING id,class_level AS "classLevel",subject_code AS "subjectCode",parent_topic_id AS "parentTopicId",
         title,learning_objectives AS "learningObjectives",learning_outcomes AS "learningOutcomes",
         suggested_resources AS "suggestedResources",source_kind AS "sourceKind",sequence_order AS "sequenceOrder"`,
      [versionId,classLevel,subjectCode,parentTopicId,
        requiredText(body.title,"title",250),JSON.stringify(objectives),JSON.stringify(outcomes),JSON.stringify(resources),
        version.source_kind,Number.isSafeInteger(body.sequenceOrder) ? body.sequenceOrder : 0],
    );
    await auditOwner(req,"Added curriculum topic",Number(inserted.rows[0].id),client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.status(201).json(inserted!.rows[0]);
}));

router.patch("/curriculum/versions/:versionId/topics/:topicId", run(async (req, res) => {
  requireOwner(req);
  const versionId = requestParam(req, "versionId");
  const topicId = requestParam(req, "topicId");
  const body = bodyObject(req.body);
  const classLevel = requiredText(body.classLevel, "classLevel", 100);
  const subjectCode = requiredText(body.subjectCode, "subjectCode", 100);
  const client = await pool.connect();
  let result;
  try {
    await client.query("BEGIN");
    const version = await ownerVersion(versionId,true,client);
    try { assertCurriculumVersionMutable(version.status); } catch (error) { throw new AuthError(409,(error as Error).message); }
    const parentTopicId = await validateTopicParent(client,body.parentTopicId,{versionId,classLevel,subjectCode},topicId);
    result = await client.query(
      `UPDATE curriculum_topics SET class_level=$1,subject_code=$2,parent_topic_id=$3,title=$4,
         learning_objectives=$5::jsonb,learning_outcomes=$6::jsonb,suggested_resources=$7::jsonb,sequence_order=$8
       WHERE id=$9 AND curriculum_version_id=$10
       RETURNING id,class_level AS "classLevel",subject_code AS "subjectCode",parent_topic_id AS "parentTopicId",
         title,learning_objectives AS "learningObjectives",learning_outcomes AS "learningOutcomes",
         suggested_resources AS "suggestedResources",source_kind AS "sourceKind",sequence_order AS "sequenceOrder"`,
      [classLevel,subjectCode,parentTopicId,
        requiredText(body.title,"title",250),JSON.stringify(arrays(body.learningObjectives,"learningObjectives")),
        JSON.stringify(arrays(body.learningOutcomes,"learningOutcomes")),JSON.stringify(arrays(body.suggestedResources,"suggestedResources")),
        Number.isSafeInteger(body.sequenceOrder) ? body.sequenceOrder : 0,topicId,versionId],
    );
    if (!result.rows[0]) throw new AuthError(404,"Curriculum topic not found");
    await auditOwner(req,"Corrected curriculum topic extraction",topicId,client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.json(result!.rows[0]);
}));

router.post("/curriculum/versions/:versionId/publish", run(async (req, res) => {
  requireOwner(req);
  const versionId = requestParam(req, "versionId");
  const client = await pool.connect();
  let result;
  try {
    await client.query("BEGIN");
    const current = await ownerVersion(versionId,true,client);
    if (current.status !== "DRAFT") throw new AuthError(409,`Only a draft version can be published (current status: ${current.status})`);
    const topics = await client.query(`SELECT 1 FROM curriculum_topics WHERE curriculum_version_id=$1 LIMIT 1`,[versionId]);
    if (!topics.rows[0]) throw new AuthError(409,"A curriculum version needs at least one verified topic before publication");
    result = await client.query(
      `UPDATE curriculum_versions SET status='PUBLISHED',published_at=now() WHERE id=$1 RETURNING ${versionColumns}`,
      [versionId],
    );
    await auditOwner(req,"Published curriculum version",versionId,client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.json(result!.rows[0]);
}));

router.post("/curriculum/versions/:versionId/archive", run(async (req, res) => {
  requireOwner(req);
  const versionId = requestParam(req, "versionId");
  const client = await pool.connect();
  let result;
  try {
    await client.query("BEGIN");
    const current = await ownerVersion(versionId,true,client);
    if (current.status !== "PUBLISHED") throw new AuthError(409,`Only a published version can be archived (current status: ${current.status})`);
    result = await client.query(
      `UPDATE curriculum_versions SET status='ARCHIVED',archived_at=now() WHERE id=$1 RETURNING ${versionColumns}`,
      [versionId],
    );
    await auditOwner(req,"Archived curriculum version",versionId,client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.json(result!.rows[0]);
}));

router.post("/curriculum/versions/:versionId/clone", run(async (req, res) => {
  const userId = requireOwner(req);
  const versionId = requestParam(req, "versionId");
  const client = await pool.connect();
  let current;
  let clone;
  try {
    await client.query("BEGIN");
    current = await ownerVersion(versionId,true,client);
    const result = await client.query(
      `INSERT INTO curriculum_versions(title,education_level,class_levels,subject_codes,source_kind,source_organization,
         source_reference,source_version,effective_date,verified_date,description,source_document_path,derived_from_version_id,created_by)
       SELECT title || ' (new draft)',education_level,class_levels,subject_codes,source_kind,source_organization,
         source_reference,source_version,effective_date,verified_date,description,source_document_path,id,$2
       FROM curriculum_versions WHERE id=$1 RETURNING ${versionColumns}`,
      [versionId,userId],
    );
    clone = result.rows[0];
    const sourceTopics = await client.query(
      `SELECT id,class_level,subject_code,parent_topic_id,title,learning_objectives,learning_outcomes,
         suggested_resources,source_kind,sequence_order FROM curriculum_topics
        WHERE curriculum_version_id=$1 ORDER BY sequence_order,id`,
      [versionId],
    );
    const pending = [...sourceTopics.rows];
    const topicIds = new Map<number,number>();
    while (pending.length) {
      const readyIndex = pending.findIndex((topic: any) => topic.parent_topic_id == null || topicIds.has(Number(topic.parent_topic_id)));
      if (readyIndex < 0) throw new AuthError(409,"Cannot clone a curriculum containing a broken or cyclic topic hierarchy");
      const [topic] = pending.splice(readyIndex,1);
      const created = await client.query(
        `INSERT INTO curriculum_topics(curriculum_version_id,class_level,subject_code,parent_topic_id,title,
           learning_objectives,learning_outcomes,suggested_resources,source_kind,sequence_order)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10) RETURNING id`,
        [clone.id,topic.class_level,topic.subject_code,
          topic.parent_topic_id == null ? null : topicIds.get(Number(topic.parent_topic_id)),topic.title,
          JSON.stringify(topic.learning_objectives),JSON.stringify(topic.learning_outcomes),
          JSON.stringify(topic.suggested_resources),topic.source_kind,topic.sequence_order],
      );
      topicIds.set(Number(topic.id),Number(created.rows[0].id));
    }
    await auditOwner(req, `Cloned curriculum version ${current.id}`, Number(clone.id), client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  const topics = await pool.query(`SELECT id,class_level AS "classLevel",subject_code AS "subjectCode",parent_topic_id AS "parentTopicId",title,
    learning_objectives AS "learningObjectives",learning_outcomes AS "learningOutcomes",suggested_resources AS "suggestedResources",
    source_kind AS "sourceKind",sequence_order AS "sequenceOrder" FROM curriculum_topics WHERE curriculum_version_id=$1 ORDER BY sequence_order,id`, [clone!.id]);
  res.status(201).json({ ...clone, topics: topics.rows });
}));

function privateBucketAndPrefix() {
  const configured = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!configured) throw new Error("PRIVATE_OBJECT_DIR is not configured for private curriculum documents");
  const segments = configured.replace(/^\/+|\/+$/g, "").split("/");
  const bucketName = segments.shift();
  if (!bucketName || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("PRIVATE_OBJECT_DIR is invalid");
  }
  return { bucketName, prefix: segments.join("/") };
}
function privateObjectPath(name: string) {
  const { bucketName, prefix } = privateBucketAndPrefix();
  return { objectPath: `/objects/${name}`, file: storage.bucket(bucketName).file([prefix, name].filter(Boolean).join("/")) };
}
async function uploadBuffer(buffer: Buffer, contentType: string) {
  const name = `curriculum-library/${randomUUID()}`;
  const target = privateObjectPath(name);
  await target.file.save(buffer, { resumable: false, metadata: { contentType, cacheControl: "private, no-store" } });
  return target.objectPath;
}
async function multipartFile(req: Request): Promise<{ filename: string; mimeType: string; buffer: Buffer }> {
  const boundary = req.headers["content-type"]?.match(/multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const token = boundary?.[1] ?? boundary?.[2];
  if (!token || token.length > 200) throw new AuthError(400, "A valid multipart form upload is required");
  const cap = 5 * 1024 * 1024;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += part.length;
    if (bytes > cap + 64 * 1024) throw new AuthError(400, "Curriculum documents are limited to 5 MB");
    chunks.push(part);
  }
  const body = Buffer.concat(chunks);
  const marker = Buffer.from(`--${token}`);
  const headerEndMarker = Buffer.from("\r\n\r\n");
  const start = body.indexOf(marker);
  const headerEnd = body.indexOf(headerEndMarker, start + marker.length);
  const next = body.indexOf(marker, headerEnd + headerEndMarker.length);
  if (start < 0 || headerEnd < 0 || next < 0) throw new AuthError(400, "Upload exactly one curriculum document");
  const headers = body.toString("utf8", start + marker.length, headerEnd);
  const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? "";
  const filenameRaw = disposition.match(/filename="([^"]*)"/i)?.[1];
  if (!filenameRaw) throw new AuthError(400, "A document file field is required");
  const filename = filenameRaw.replace(/\\/g, "/").split("/").pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  const mimeType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() ?? "application/octet-stream";
  const dataEnd = next >= 2 && body.subarray(next - 2, next).toString() === "\r\n" ? next - 2 : next;
  const buffer = body.subarray(headerEnd + headerEndMarker.length, dataEnd);
  if (!filename || filename.length > 180 || !buffer.length || buffer.length > cap) throw new AuthError(400, "Invalid document name or size (maximum 5 MB)");
  return { filename, mimeType, buffer };
}
function parseCurriculumDocument(file: { filename: string; mimeType: string; buffer: Buffer }) {
  try {
    const parsed = parseImportFile(file);
    if (!parsed.rows.length) throw new Error("No readable table rows found");
    return parsed;
  } catch (error) {
    throw new AuthError(400, `Document extraction failed: ${(error as Error).message}`);
  }
}

router.post("/curriculum/imports/preview", run(async (req, res) => {
  const ownerId = requireOwner(req);
  const uploaded = await multipartFile(req);
  const parsed = parseCurriculumDocument(uploaded);
  if (parsed.rows.length > 5000) throw new AuthError(400,"Curriculum documents are limited to 5000 extracted topic rows");
  const objectPath = await uploadBuffer(uploaded.buffer, uploaded.mimeType);
  const headers = [...new Set(parsed.rows.flatMap((row) => Object.keys(row.values)))];
  const created = await pool.query(
    `INSERT INTO curriculum_imports(uploaded_by,filename,content_type,object_path,detected_type,preview_rows,headers)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
     RETURNING id`,
    [ownerId,uploaded.filename,uploaded.mimeType,objectPath,parsed.detectedType,JSON.stringify(parsed.rows.map((r) => r.values)),JSON.stringify(headers)],
  );
  await auditOwner(req, "Uploaded and extracted official curriculum document", Number(created.rows[0].id));
  res.json({
    importId: Number(created.rows[0].id),
    detectedType: parsed.detectedType,
    headers,
    rows: parsed.rows.map((row) => row.values),
    mapping: {},
    warnings: parsed.detectedType === "pdf" ? ["Only text-table content actually extracted from the readable PDF is shown; unrecognized columns must be entered by an authorized reviewer."] : [],
  });
}));

router.post("/curriculum/imports/:importId/confirm", run(async (req, res) => {
  const ownerId = requireOwner(req);
  const importId = requestParam(req, "importId");
  const body = bodyObject(req.body);
  if (!body.version || typeof body.version !== "object" || Array.isArray(body.version)) throw new AuthError(400,"version metadata is required");
  const input = versionInput({ ...body.version,sourceKind:"OFFICIAL" });
  const mapping = body.mapping;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new AuthError(400, "mapping must be an object");
  if (body.reviewerConfirmed !== true) throw new AuthError(400,"reviewerConfirmed must be true after reviewing the extracted source rows and metadata");
  const imported = await pool.query(`SELECT * FROM curriculum_imports WHERE id=$1 AND uploaded_by=$2 AND confirmed_version_id IS NULL`, [importId,ownerId]);
  if (!imported.rows[0]) throw new AuthError(404, "Unused curriculum import not found");
  let importRow = imported.rows[0];
  let mapped: Array<{ sourceRow: number; values: Record<string,string> }>;
  try {
    const extracted = mapCurriculumImportRows(
      (importRow.preview_rows as Record<string, string>[]).map((values, index) => ({ sourceRow: index + 2, values })),
      mapping,
      importRow.headers,
    );
    if (body.correctedRows === undefined) {
      mapped = extracted;
    } else {
      if (!Array.isArray(body.correctedRows) || body.correctedRows.length === 0 || body.correctedRows.length > 5000) {
        throw new Error("correctedRows must contain between 1 and 5000 reviewed topic rows");
      }
      const allowedFields = new Set(["classLevel","subjectCode","title","learningObjectives","learningOutcomes","suggestedResources"]);
      mapped = body.correctedRows.map((row: unknown,index: number) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Corrected row ${index + 1} must be an object`);
        const corrected = row as Record<string,unknown>;
        if (Object.keys(corrected).some((key) => !allowedFields.has(key))) throw new Error(`Corrected row ${index + 1} contains an unsupported curriculum field`);
        const values: Record<string,string> = {};
        for (const field of allowedFields) {
          const value = corrected[field];
          if (value !== undefined && (typeof value !== "string" || value.length > 2000)) {
            throw new Error(`Corrected row ${index + 1} field ${field} must be text of at most 2000 characters`);
          }
          if (typeof value === "string") values[field] = value.trim();
        }
        return { sourceRow:index + 2,values };
      });
    }
  } catch (error) { throw new AuthError(400, (error as Error).message); }
  for (const row of mapped) {
    for (const required of ["classLevel", "subjectCode", "title"]) {
      if (!row.values[required]?.trim()) throw new AuthError(400, `Source row ${row.sourceRow} is missing mapped ${required}`);
    }
    if (Object.values(row.values).some((value) => value.length > 2000)) {
      throw new AuthError(400,`Source row ${row.sourceRow} contains a field longer than 2000 characters`);
    }
  }
  const client = await pool.connect();
  let version;
  try {
    await client.query("BEGIN");
    const lockedImport = await client.query(
      `SELECT * FROM curriculum_imports WHERE id=$1 AND uploaded_by=$2 AND confirmed_version_id IS NULL FOR UPDATE`,
      [importId,ownerId],
    );
    if (!lockedImport.rows[0]) throw new AuthError(409,"Curriculum import has already been confirmed");
    importRow = lockedImport.rows[0];
    const created = await client.query(
      `INSERT INTO curriculum_versions(title,education_level,class_levels,subject_codes,source_kind,source_organization,
         source_reference,source_version,effective_date,verified_date,description,source_document_path,created_by)
       VALUES($1,$2,$3::jsonb,$4::jsonb,'OFFICIAL',$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${versionColumns}`,
      [input.title,input.educationLevel,JSON.stringify(input.classLevels),
        JSON.stringify([...new Set(mapped.map((row) => row.values.subjectCode))]),input.sourceOrganization,input.sourceReference,
        input.sourceVersion,input.effectiveDate,input.verifiedDate,input.description,importRow.object_path,ownerId],
    );
    version = created.rows[0];
    for (const row of mapped) {
      const list = (value: string | undefined) => value ? value.split(/\s*[|;]\s*/).filter(Boolean) : [];
      await client.query(
        `INSERT INTO curriculum_topics(curriculum_version_id,class_level,subject_code,title,learning_objectives,
          learning_outcomes,suggested_resources,source_kind)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'OFFICIAL')`,
        [version.id,row.values.classLevel,row.values.subjectCode,row.values.title,JSON.stringify(list(row.values.learningObjectives)),
          JSON.stringify(list(row.values.learningOutcomes)),JSON.stringify(list(row.values.suggestedResources))],
      );
    }
    await client.query(`UPDATE curriculum_imports SET confirmed_version_id=$1 WHERE id=$2 AND uploaded_by=$3`, [version.id,importId,ownerId]);
    await auditOwner(req, "Imported reviewed curriculum document as draft", Number(version.id), client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  const topics = await pool.query(`SELECT id,class_level AS "classLevel",subject_code AS "subjectCode",parent_topic_id AS "parentTopicId",title,
    learning_objectives AS "learningObjectives",learning_outcomes AS "learningOutcomes",suggested_resources AS "suggestedResources",
    source_kind AS "sourceKind",sequence_order AS "sequenceOrder" FROM curriculum_topics WHERE curriculum_version_id=$1 ORDER BY id`, [version!.id]);
  res.status(201).json({ ...version, topics: topics.rows });
}));

router.get("/curriculum/imports/:importId/download", run(async (req, res) => {
  const ownerId = requireOwner(req);
  const imported = await pool.query(`SELECT object_path,filename,content_type FROM curriculum_imports WHERE id=$1`, [requestParam(req,"importId")]);
  if (!imported.rows[0]) throw new AuthError(404, "Curriculum source document not found");
  // Owners operate the global library; upload attribution is retained for audit but
  // does not turn an official source object into a public asset.
  const objectPath = String(imported.rows[0].object_path);
  if (!objectPath.startsWith("/objects/curriculum-library/")) throw new AuthError(404, "Curriculum source document not found");
  const target = privateObjectPath(objectPath.slice("/objects/".length));
  const [contents] = await target.file.download();
  res.setHeader("Content-Type", imported.rows[0].content_type);
  res.setHeader("Content-Disposition", `attachment; filename="${String(imported.rows[0].filename).replace(/["\r\n]/g, "")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(contents);
}));

async function validateAcademicContext(
  school: number, session: number, term: number, classId: number, subjectId: number, section: string | null = null,
) {
  const result = await pool.query(
    `SELECT c.id,c.name AS class_name,sub.code AS subject_code,sub.name AS subject_name
       FROM school_classes c
       JOIN academic_sessions s ON s.id=$2 AND s.school_id=c.school_id
       JOIN academic_terms t ON t.id=$3 AND t.school_id=c.school_id AND t.academic_session_id=s.id
       JOIN subjects sub ON sub.id=$5 AND sub.school_id=c.school_id
      WHERE c.id=$4 AND c.school_id=$1
        AND ${lessonTeachingScope(["$1","$2","$3","$4","$5","NULL","COALESCE($6,c.section,'')"],false)}`,
     [school,session,term,classId,subjectId,section],
  );
  if (!result.rows[0]) throw new AuthError(404, "Academic class, subject, session, or term is not configured for this school");
  return result.rows[0];
}
async function validateTeacherAssignment(
  school: number, userId: number, session: number, term: number, classId: number, subjectId: number, section: string | null,
) {
  const result = await pool.query(
     `SELECT e.id FROM employees e
       JOIN school_classes c ON c.id=$5 AND c.school_id=e.school_id
       JOIN academic_sessions ac ON ac.id=$3 AND ac.school_id=e.school_id
       JOIN academic_terms term ON term.id=$4 AND term.school_id=e.school_id AND term.academic_session_id=ac.id
       JOIN subjects sub ON sub.id=$6 AND sub.school_id=e.school_id
      WHERE e.school_id=$1 AND e.user_id=$2 AND e.employment_status='ACTIVE' AND e.employee_type='TEACHER'
        AND ${lessonTeachingScope(["$1","$3","$4","$5","$6","e.id","COALESCE($7,c.section,'')"])}`,
    [school,userId,session,term,classId,subjectId,section],
  );
  if (!result.rows[0]) throw new AuthError(403, "Teacher is not assigned to this class, subject, session, and section");
  return Number(result.rows[0].id);
}

router.get("/schools/:schoolId/curriculum/teaching-context", run(async (req,res) => {
  const school = schoolId(req);
  requireSchoolTeacher(req,school);
  const userId = getUserContext(req).user.id;
  const sessionId = asyncId(req.query.sessionId,"sessionId");
  const termId = asyncId(req.query.termId,"termId");
  const result = await pool.query(
     `SELECT DISTINCT c.id AS "classId",c.name AS "className",NULLIF(c.section,'') AS section,
       s.id AS "subjectId",s.name AS "subjectName",s.code AS "subjectCode",
        a.id AS "sessionId",term.id AS "termId"
      FROM employees e
       JOIN school_classes c ON c.school_id=e.school_id
       JOIN academic_sessions a ON a.id=$3 AND a.school_id=e.school_id
       JOIN academic_terms term ON term.id=$4 AND term.school_id=e.school_id
        AND term.academic_session_id=a.id
       JOIN subjects s ON s.school_id=e.school_id
     WHERE e.school_id=$1 AND e.user_id=$2 AND e.employee_type='TEACHER' AND e.employment_status='ACTIVE'
        AND ${lessonTeachingScope(["$1","$3","$4","c.id","s.id","e.id","COALESCE(c.section,'')"])}
     ORDER BY "className",section,"subjectName"`,
    [school,userId,sessionId,termId],
  );
  res.json(result.rows);
}));

router.get("/schools/:schoolId/curriculum", run(async (req, res) => {
  const school = schoolId(req);
  requireTeacherOrAdmin(req, school);
  const context = getUserContext(req);
  const admin = context.roles.some((role) => role.role === "SCHOOL_ADMIN" && role.schoolId === school && role.status === "ACTIVE");
  const filters: unknown[] = [school,context.user.id,admin];
  const predicates: string[] = [];
  for (const [name, column] of [["classId","m.school_class_id"],["subjectId","m.subject_id"],["sessionId","m.academic_session_id"],["termId","m.academic_term_id"]] as const) {
    if (req.query[name] !== undefined) { filters.push(asyncId(req.query[name],name)); predicates.push(`${column}=$${filters.length}`); }
  }
  const result = await pool.query(
    `SELECT m.id,m.school_id AS "schoolId",m.curriculum_version_id AS "versionId",m.school_class_id AS "classId",
       m.subject_id AS "subjectId",m.academic_session_id AS "sessionId",m.academic_term_id AS "termId",
       m.status,m.confirmed_at AS "confirmedAt",
       jsonb_build_object('id',v.id,'title',v.title,'educationLevel',v.education_level,'classLevels',v.class_levels,
         'subjectCodes',v.subject_codes,'sourceKind',v.source_kind,'sourceOrganization',v.source_organization,
         'sourceReference',v.source_reference,'sourceVersion',v.source_version,'effectiveDate',v.effective_date,
         'verifiedDate',v.verified_date,'status',v.status,'description',v.description,
         'derivedFromVersionId',v.derived_from_version_id,'createdAt',v.created_at,
         'publishedAt',v.published_at,'archivedAt',v.archived_at,
         'sourceImportId',(SELECT ci.id FROM curriculum_imports ci WHERE ci.confirmed_version_id=v.id OR
           (v.source_document_path IS NOT NULL AND ci.object_path=v.source_document_path)
           ORDER BY CASE WHEN ci.confirmed_version_id=v.id THEN 0 ELSE 1 END,ci.id DESC LIMIT 1)) AS "curriculumVersion"
      FROM school_curriculum_assignments m JOIN curriculum_versions v ON v.id=m.curriculum_version_id
      WHERE m.school_id=$1 AND ($3::boolean OR EXISTS(
         SELECT 1 FROM employees e JOIN school_classes c ON c.id=m.school_class_id AND c.school_id=m.school_id
        WHERE e.user_id=$2 AND e.school_id=m.school_id AND e.employee_type='TEACHER' AND e.employment_status='ACTIVE'
           AND ${lessonTeachingScope(["m.school_id","m.academic_session_id","m.academic_term_id","m.school_class_id","m.subject_id","e.id","COALESCE(c.section,'')"])}
      ) OR EXISTS(SELECT 1 FROM lesson_notes hn JOIN employees he ON he.id=hn.teacher_employee_id
        WHERE hn.curriculum_mapping_id=m.id AND hn.school_id=m.school_id AND he.user_id=$2))
        AND ($3::boolean OR m.status='ACTIVE' OR EXISTS(
          SELECT 1 FROM lesson_notes hn JOIN employees he ON he.id=hn.teacher_employee_id
           WHERE hn.curriculum_mapping_id=m.id AND hn.school_id=m.school_id AND he.user_id=$2))
      ${predicates.length ? `AND ${predicates.join(" AND ")}` : ""}
      ORDER BY m.academic_session_id DESC,m.academic_term_id DESC,m.school_class_id,m.subject_id`,
    filters,
  );
  res.json(result.rows);
}));

router.get("/schools/:schoolId/curriculum/:mappingId/topics", run(async (req,res) => {
  const school = schoolId(req);
  requireTeacherOrAdmin(req,school);
  const mappingId = requestParam(req,"mappingId");
  const context = getUserContext(req);
  const admin = context.roles.some((role) => role.role === "SCHOOL_ADMIN" && role.schoolId === school && role.status === "ACTIVE");
  const mapping = await pool.query(
    `SELECT m.*,c.section FROM school_curriculum_assignments m
       JOIN school_classes c ON c.id=m.school_class_id AND c.school_id=m.school_id
      WHERE m.id=$1 AND m.school_id=$2`,
    [mappingId,school],
  );
  const current = mapping.rows[0];
  if (!current) throw new AuthError(404,"Curriculum mapping not found");
  if (!admin) {
    const teacherAssignment = await pool.query(
      `SELECT e.id FROM employees e
       WHERE e.user_id=$1 AND e.school_id=$2 AND e.employee_type='TEACHER' AND e.employment_status='ACTIVE' AND $9='ACTIVE'
         AND ${lessonTeachingScope(["$2","$3","$7","$4","$6","e.id","COALESCE($5,'')"])}
       UNION ALL
       SELECT e.id FROM lesson_notes hn JOIN employees e ON e.id=hn.teacher_employee_id
        WHERE hn.curriculum_mapping_id=$8 AND hn.school_id=$2 AND e.user_id=$1
       LIMIT 1`,
      [context.user.id,school,current.academic_session_id,current.school_class_id,current.section,current.subject_id,current.academic_term_id,mappingId,current.status],
    );
    if (!teacherAssignment.rows[0]) throw new AuthError(404,"Curriculum mapping not found");
  }
  const result = await pool.query(
    `SELECT t.id,t.class_level AS "classLevel",t.subject_code AS "subjectCode",t.parent_topic_id AS "parentTopicId",
       t.title,t.learning_objectives AS "learningObjectives",t.learning_outcomes AS "learningOutcomes",
       t.suggested_resources AS "suggestedResources",t.source_kind AS "sourceKind",t.sequence_order AS "sequenceOrder"
     FROM curriculum_topics t
     JOIN school_classes c ON c.id=$4 AND c.school_id=$1
     JOIN subjects s ON s.id=$5 AND s.school_id=$1
      WHERE (regexp_replace(lower(t.class_level),'[^a-z0-9]','','g')=
               regexp_replace(lower(c.name),'[^a-z0-9]','','g')
         AND regexp_replace(lower(t.subject_code),'[^a-z0-9]','','g') IN
               (regexp_replace(lower(s.code),'[^a-z0-9]','','g'),regexp_replace(lower(s.name),'[^a-z0-9]','','g'))
        AND t.curriculum_version_id=$3 AND t.mapping_id IS NULL)
         OR (regexp_replace(lower(t.class_level),'[^a-z0-9]','','g')=
               regexp_replace(lower(c.name),'[^a-z0-9]','','g')
           AND regexp_replace(lower(t.subject_code),'[^a-z0-9]','','g') IN
               (regexp_replace(lower(s.code),'[^a-z0-9]','','g'),regexp_replace(lower(s.name),'[^a-z0-9]','','g'))
          AND t.mapping_id=$2 AND t.school_id=$1 AND t.source_kind='SCHOOL_SPECIFIC')
     ORDER BY t.class_level,t.subject_code,t.sequence_order,t.id`,
    [school,mappingId,current.curriculum_version_id,current.school_class_id,current.subject_id],
  );
  const progress = await pool.query(
    `SELECT id,school_id AS "schoolId",mapping_id AS "mappingId",topic_id AS "topicId",
       progress_status AS "progressStatus",completed_date AS "completedDate",comment,updated_by AS "updatedBy",
       updated_at AS "updatedAt" FROM curriculum_progress WHERE school_id=$1 AND mapping_id=$2 ORDER BY topic_id`,
    [school,mappingId],
  );
  const curriculumVersion = await pool.query(`SELECT ${versionColumns} FROM curriculum_versions WHERE id=$1`,[current.curriculum_version_id]);
  const { sourceDocumentPath: _privatePath,...publicVersion } = curriculumVersion.rows[0] ?? {};
  res.json({ topics:result.rows,progress:progress.rows,curriculumVersion:curriculumVersion.rows[0] ? publicVersion : null });
}));

router.post("/schools/:schoolId/curriculum", run(async (req, res) => {
  const school = schoolId(req);
  requireSchoolAdmin(req, school);
  const body = bodyObject(req.body);
  const versionId = asyncId(body.versionId,"versionId");
  const classId = asyncId(body.classId,"classId");
  const subjectId = asyncId(body.subjectId,"subjectId");
  const sessionId = asyncId(body.sessionId,"sessionId");
  const termId = asyncId(body.termId,"termId");
  const [academic, version] = await Promise.all([
    validateAcademicContext(school,sessionId,termId,classId,subjectId),
    pool.query(`SELECT id,status,class_levels,subject_codes FROM curriculum_versions WHERE id=$1`, [versionId]),
  ]);
  const curriculum = version.rows[0];
  if (!curriculum || curriculum.status !== "PUBLISHED") throw new AuthError(404, "Published curriculum version not found");
  if (Array.isArray(curriculum.class_levels) && curriculum.class_levels.length &&
      !curriculum.class_levels.some((level: string) => normalizeCurriculumLabel(level) === normalizeCurriculumLabel(academic.class_name))) {
    throw new AuthError(400, "Selected curriculum version does not apply to this class");
  }
  if (Array.isArray(curriculum.subject_codes) && curriculum.subject_codes.length &&
      !curriculum.subject_codes.some((code: string) => {
        const normalized = normalizeCurriculumLabel(code);
        return normalized === normalizeCurriculumLabel(academic.subject_code) ||
          normalized === normalizeCurriculumLabel(academic.subject_name);
      })) {
    throw new AuthError(400, "Selected curriculum version does not apply to this subject");
  }
  const actor = getUserContext(req);
  const client = await pool.connect();
  let result;
  let created = true;
  try {
    await client.query("BEGIN");
    const contextKey = `${classId}:${subjectId}:${sessionId}:${termId}`;
    await client.query(`SELECT pg_advisory_xact_lock($1::integer,hashtext($2))`,[school,contextKey]);
    const existing = await client.query(
      `SELECT id,curriculum_version_id FROM school_curriculum_assignments
        WHERE school_id=$1 AND school_class_id=$2 AND subject_id=$3 AND academic_session_id=$4
          AND academic_term_id=$5 AND status='ACTIVE' FOR UPDATE`,
      [school,classId,subjectId,sessionId,termId],
    );
    if (existing.rows[0] && Number(existing.rows[0].curriculum_version_id) === versionId) {
      created = false;
      result = await client.query(
        `SELECT id,school_id AS "schoolId",curriculum_version_id AS "versionId",school_class_id AS "classId",
           subject_id AS "subjectId",academic_session_id AS "sessionId",academic_term_id AS "termId",status,confirmed_at AS "confirmedAt"
           FROM school_curriculum_assignments WHERE id=$1 AND school_id=$2`,
        [existing.rows[0].id,school],
      );
    } else {
      if (existing.rows[0]) {
        await client.query(`UPDATE school_curriculum_assignments SET status='ARCHIVED' WHERE id=$1 AND school_id=$2`,
          [existing.rows[0].id,school]);
      }
      result = await client.query(
        `INSERT INTO school_curriculum_assignments(school_id,curriculum_version_id,school_class_id,subject_id,academic_session_id,academic_term_id,confirmed_by)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,school_id AS "schoolId",curriculum_version_id AS "versionId",school_class_id AS "classId",
           subject_id AS "subjectId",academic_session_id AS "sessionId",academic_term_id AS "termId",status,confirmed_at AS "confirmedAt"`,
        [school,versionId,classId,subjectId,sessionId,termId,actor.user.id],
      );
    }
    await audit(req,school,created ? "Confirmed school curriculum mapping" : "Reconfirmed school curriculum mapping",Number(result.rows[0].id),client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.status(created ? 201 : 200).json(result!.rows[0]);
}));

router.post("/schools/:schoolId/curriculum/:mappingId/topics", run(async (req, res) => {
  const school = schoolId(req);
  requireSchoolAdmin(req, school);
  const mappingId = requestParam(req,"mappingId");
  const body = bodyObject(req.body);
  const mapping = await pool.query(
    `SELECT m.id,m.status,m.subject_id AS "subjectId",c.name AS "className",s.code AS "subjectCode"
       FROM school_curriculum_assignments m
       JOIN school_classes c ON c.id=m.school_class_id AND c.school_id=m.school_id
       JOIN subjects s ON s.id=m.subject_id AND s.school_id=m.school_id
      WHERE m.id=$1 AND m.school_id=$2`,
    [mappingId,school],
  );
  const current = mapping.rows[0];
  if (!current) throw new AuthError(404, "Curriculum mapping not found");
  if (current.status !== "ACTIVE") throw new AuthError(409,"Archived curriculum mappings cannot receive new school-specific topics");
  const classLevel = requiredText(body.classLevel,"classLevel",100);
  if (normalizeCurriculumLabel(classLevel) !== normalizeCurriculumLabel(current.className)) {
    throw new AuthError(400,"School-specific topic classLevel must match its curriculum mapping");
  }
  if (asyncId(body.subjectId,"subjectId") !== Number(current.subjectId)) throw new AuthError(400, "School-specific topic subject must match the mapping");
  const parentTopicId = await validateTopicParent(pool,body.parentTopicId,{
    mappingId,schoolId:school,classLevel:current.className,subjectCode:current.subjectCode,
  });
  const result = await pool.query(
    `INSERT INTO curriculum_topics(school_id,mapping_id,class_level,subject_code,parent_topic_id,title,
       learning_objectives,learning_outcomes,suggested_resources,source_kind)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'SCHOOL_SPECIFIC')
     RETURNING id,class_level AS "classLevel",subject_code AS "subjectCode",parent_topic_id AS "parentTopicId",
       title,learning_objectives AS "learningObjectives",learning_outcomes AS "learningOutcomes",
       suggested_resources AS "suggestedResources",source_kind AS "sourceKind"`,
    [school,mappingId,current.className,current.subjectCode,parentTopicId,
      requiredText(body.title,"title",250),JSON.stringify(arrays(body.learningObjectives,"learningObjectives")),
      JSON.stringify(arrays(body.learningOutcomes,"learningOutcomes")),JSON.stringify(arrays(body.suggestedResources,"suggestedResources"))],
  );
  await audit(req,school,"Added school-specific curriculum topic",Number(result.rows[0].id));
  res.status(201).json(result.rows[0]);
}));

router.post("/schools/:schoolId/curriculum/:mappingId/progress", run(async (req, res) => {
  const school = schoolId(req);
  requireTeacherOrAdmin(req, school);
  const mappingId = requestParam(req,"mappingId");
  const body = bodyObject(req.body);
  const context = getUserContext(req);
  const mapping = await pool.query(
    `SELECT m.*,c.section FROM school_curriculum_assignments m
       JOIN school_classes c ON c.id=m.school_class_id AND c.school_id=m.school_id
      WHERE m.id=$1 AND m.school_id=$2`,
    [mappingId,school],
  );
  if (!mapping.rows[0]) throw new AuthError(404, "Curriculum mapping not found");
  if (mapping.rows[0].status !== "ACTIVE") throw new AuthError(409,"Archived curriculum mappings cannot receive progress updates");
  const isAdmin = context.roles.some((role) => role.role === "SCHOOL_ADMIN" && role.schoolId === school && role.status === "ACTIVE");
  const topicId = asyncId(body.topicId,"topicId");
  if (!isAdmin) {
    await validateTeacherAssignment(school,context.user.id,Number(mapping.rows[0].academic_session_id),Number(mapping.rows[0].academic_term_id),
      Number(mapping.rows[0].school_class_id),Number(mapping.rows[0].subject_id),String(mapping.rows[0].section ?? ""));
  }
  const topic = await pool.query(
    `SELECT t.id FROM curriculum_topics t
       JOIN school_classes c ON c.id=$5 AND c.school_id=$4
       JOIN subjects s ON s.id=$6 AND s.school_id=$4
      WHERE t.id=$1
        AND regexp_replace(lower(t.class_level),'[^a-z0-9]','','g')=
            regexp_replace(lower(c.name),'[^a-z0-9]','','g')
        AND regexp_replace(lower(t.subject_code),'[^a-z0-9]','','g') IN
            (regexp_replace(lower(s.code),'[^a-z0-9]','','g'),regexp_replace(lower(s.name),'[^a-z0-9]','','g'))
        AND ((t.curriculum_version_id=$2 AND t.mapping_id IS NULL)
          OR (t.mapping_id=$3 AND t.school_id=$4 AND t.source_kind='SCHOOL_SPECIFIC'))`,
    [topicId,mapping.rows[0].curriculum_version_id,mappingId,school,mapping.rows[0].school_class_id,mapping.rows[0].subject_id],
  );
  if (!topic.rows[0]) throw new AuthError(404, "Topic is not part of this curriculum mapping");
  const status = requiredText(body.progressStatus,"progressStatus",20);
  if (!["PLANNED","IN_PROGRESS","COMPLETED","DEFERRED"].includes(status)) throw new AuthError(400,"progressStatus is invalid");
  const completedDate = dateOnly(body.completedDate,"completedDate");
  const result = await pool.query(
    `INSERT INTO curriculum_progress(school_id,mapping_id,topic_id,progress_status,completed_date,comment,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(school_id,mapping_id,topic_id) DO UPDATE SET progress_status=EXCLUDED.progress_status,
       completed_date=EXCLUDED.completed_date,comment=EXCLUDED.comment,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING id,school_id AS "schoolId",mapping_id AS "mappingId",topic_id AS "topicId",
       progress_status AS "progressStatus",completed_date AS "completedDate",comment,updated_at AS "updatedAt"`,
    [school,mappingId,topicId,status,completedDate,optionalText(body.comment,"comment"),context.user.id],
  );
  await audit(req,school,"Recorded explicit curriculum teaching progress",Number(result.rows[0].id));
  res.status(201).json(result.rows[0]);
}));

async function ensureNoteContext(school: number, input: Record<string, any>, userId: number, teacherId?: number, pinned?: Record<string,any>) {
  const samePinned = !!pinned && JSON.stringify(lessonDocumentContext({...input,schoolId:school,teacherId:pinned.teacherId})) ===
    JSON.stringify(lessonDocumentContext(pinned));
  const academic = await validateAcademicContext(school,input.sessionId,input.termId,input.classId,input.subjectId,input.section ?? null);
  if (input.subTopicId != null && input.topicId == null) throw new AuthError(400,"subTopicId requires its selected topicId");
  if (input.curriculumMappingId != null) {
    const mapping = await pool.query(
      `SELECT id,curriculum_version_id FROM school_curriculum_assignments
        WHERE id=$1 AND school_id=$2 AND school_class_id=$3 AND subject_id=$4
           AND academic_session_id=$5 AND academic_term_id=$6 AND (status='ACTIVE' OR $7::boolean)`,
       [input.curriculumMappingId,school,input.classId,input.subjectId,input.sessionId,input.termId,samePinned],
    );
    if (!mapping.rows[0]) throw new AuthError(404,"Curriculum mapping not found for lesson context");
    if (input.curriculumVersionId != null && input.curriculumVersionId !== Number(mapping.rows[0].curriculum_version_id)) {
      throw new AuthError(400,"Curriculum version must match the confirmed school mapping");
    }
    input.curriculumVersionId = Number(mapping.rows[0].curriculum_version_id);
  } else if (input.curriculumVersionId != null) {
    if (!samePinned) throw new AuthError(404,"Select the school's confirmed curriculum mapping for this lesson context");
    const version = await pool.query(`SELECT id,status FROM curriculum_versions WHERE id=$1`,[input.curriculumVersionId]);
    if (!version.rows[0] || !["PUBLISHED","ARCHIVED"].includes(version.rows[0].status)) throw new AuthError(404,"Curriculum version not found");
  }
  if (input.topicId != null) {
    const topic = await pool.query(
      `SELECT id,parent_topic_id FROM curriculum_topics t
       WHERE t.id=$1
         AND regexp_replace(lower(t.class_level),'[^a-z0-9]','','g')=
             regexp_replace(lower($5),'[^a-z0-9]','','g')
         AND regexp_replace(lower(t.subject_code),'[^a-z0-9]','','g') IN
          (SELECT regexp_replace(lower(code),'[^a-z0-9]','','g') FROM subjects WHERE id=$6 AND school_id=$4
           UNION SELECT regexp_replace(lower(name),'[^a-z0-9]','','g') FROM subjects WHERE id=$6 AND school_id=$4)
       AND ((t.curriculum_version_id=$2 AND t.mapping_id IS NULL) OR
         (t.mapping_id=$3 AND t.school_id=$4 AND t.source_kind='SCHOOL_SPECIFIC'))`,
      [input.topicId,input.curriculumVersionId ?? null,input.curriculumMappingId ?? null,school,academic.class_name, input.subjectId],
    );
    if (!topic.rows[0]) throw new AuthError(404,"Curriculum topic is not in the selected version");
    if (input.subTopicId != null) {
      const sub = await pool.query(
        `SELECT id FROM curriculum_topics t WHERE t.id=$1 AND t.parent_topic_id=$2
          AND regexp_replace(lower(t.class_level),'[^a-z0-9]','','g')=
              regexp_replace(lower($6),'[^a-z0-9]','','g')
          AND regexp_replace(lower(t.subject_code),'[^a-z0-9]','','g') IN
            (SELECT regexp_replace(lower(code),'[^a-z0-9]','','g') FROM subjects WHERE id=$7 AND school_id=$5
             UNION SELECT regexp_replace(lower(name),'[^a-z0-9]','','g') FROM subjects WHERE id=$7 AND school_id=$5)
         AND ((t.curriculum_version_id=$3 AND t.mapping_id IS NULL) OR (t.mapping_id=$4 AND t.school_id=$5 AND t.source_kind='SCHOOL_SPECIFIC'))`,
        [input.subTopicId,input.topicId,input.curriculumVersionId ?? null,input.curriculumMappingId ?? null,school,academic.class_name,input.subjectId],
      );
      if (!sub.rows[0]) throw new AuthError(404,"Subtopic is not part of the selected curriculum topic");
    }
  }
  return { academic, teacherId };
}
async function notifyUser(client: any, userId: number, school: number, classId: number, key: string, subject: string, body: string) {
  await queueCommunicationNotification(client,{
    recipientUserId:userId,schoolId:school,subjectClassId:classId,category:"ACADEMIC",eventKey:key,
    subject,body,link:"/academics/lesson-notes",channels:["IN_APP"],
  });
}

router.post("/schools/:schoolId/lesson-notes", run(async (req,res) => {
  const school = schoolId(req);
  requireSchoolTeacher(req,school);
  const context = getUserContext(req);
  const input = lessonInput(bodyObject(req.body));
  const teacherId = await validateTeacherAssignment(school,context.user.id,input.sessionId,input.termId,input.classId,input.subjectId,input.section ?? null);
  await ensureNoteContext(school,input,context.user.id,teacherId);
  const result = await pool.query(
    `INSERT INTO lesson_notes(school_id,academic_session_id,academic_term_id,school_class_id,subject_id,teacher_employee_id,
       section,week,lesson_date,curriculum_mapping_id,curriculum_version_id,topic_id,sub_topic_id,content,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15) RETURNING ${noteReturning}`,
    [school,input.sessionId,input.termId,input.classId,input.subjectId,teacherId,input.section ?? null,input.week,input.date,
      input.curriculumMappingId ?? null,input.curriculumVersionId ?? null,input.topicId ?? null,input.subTopicId ?? null,
      JSON.stringify(input.content ?? {}),context.user.id],
  ).catch((error:{code?:string;constraint?:string})=>{
    if(error.code==="23505"&&error.constraint==="lesson_notes_week_assignment_unique")
      throw new AuthError(409,"A lesson note already exists for this teaching assignment and week. Open the existing note or choose a different week.");
    throw error;
  });
  await audit(req,school,"Created lesson-note draft",Number(result.rows[0].id));
  res.status(201).json(await addPinnedVersion(result.rows[0]));
}));

function requireNoteRead(req: Request, school: number) {
  if (noteOwnerReader(req)) assertSchoolAccess(req,school,["PLATFORM_OWNER"]);
  else requireTeacherOrAdmin(req,school);
}
function noteOwnerReader(req: Request) {
  return getUserContext(req).roles.some(r => r.role === "PLATFORM_OWNER" && r.schoolId === null && r.status === "ACTIVE");
}
router.get("/schools/:schoolId/lesson-notes", run(async (req,res) => {
  const school = schoolId(req);
   requireNoteRead(req,school);
  const context = getUserContext(req);
  const admin = context.roles.some((role) => role.role === "SCHOOL_ADMIN" && role.schoolId === school && role.status === "ACTIVE");
   const values: unknown[] = [school,context.user.id,admin || noteOwnerReader(req)];
  const where = [
    `n.school_id=$1`,
    `($3::boolean OR EXISTS(SELECT 1 FROM employees own WHERE own.id=n.teacher_employee_id AND own.user_id=$2))`,
  ];
  for (const [name,column] of [["sessionId","n.academic_session_id"],["termId","n.academic_term_id"],["week","n.week"],["teacherId","n.teacher_employee_id"],["classId","n.school_class_id"],["subjectId","n.subject_id"]] as const) {
    if (req.query[name] !== undefined) { values.push(asyncId(req.query[name],name)); where.push(`${column}=$${values.length}`); }
  }
  if (req.query.status !== undefined) {
    const status = String(req.query.status);
    if (!["DRAFT","SUBMITTED","RETURNED","RESUBMITTED","APPROVED","ARCHIVED"].includes(status)) throw new AuthError(400,"status is invalid");
    values.push(status); where.push(`n.status=$${values.length}`);
  }
  const result = await pool.query(
    `SELECT ${noteColumns},e.first_name AS "teacherFirstName",e.last_name AS "teacherLastName",
       (SELECT r.comment FROM lesson_note_reviews r WHERE r.lesson_note_id=n.id AND r.school_id=n.school_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS "latestReviewComment"
     FROM lesson_notes n JOIN employees e ON e.id=n.teacher_employee_id AND e.school_id=n.school_id
     WHERE ${where.join(" AND ")} ORDER BY n.academic_session_id DESC,n.academic_term_id DESC,n.week DESC,n.updated_at DESC`,
    values,
  );
  res.json(await Promise.all(result.rows.map((note: Record<string,any>) => addPinnedVersion(note))));
}));

async function getPrivateNote(req: Request, school: number, noteId: number, lock = false, client: any = pool) {
  const context = getUserContext(req);
  const admin = context.roles.some((role) => role.role === "SCHOOL_ADMIN" && role.schoolId === school && role.status === "ACTIVE");
  const found = await client.query(
    `SELECT ${noteColumns},e.user_id AS "teacherUserId",
       (SELECT r.comment FROM lesson_note_reviews r WHERE r.lesson_note_id=n.id AND r.school_id=n.school_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS "latestReviewComment"
      FROM lesson_notes n JOIN employees e ON e.id=n.teacher_employee_id AND e.school_id=n.school_id
     WHERE n.id=$1 AND n.school_id=$2 ${lock ? "FOR UPDATE OF n" : ""}`,
    [noteId,school],
  );
  const note = found.rows[0];
  if (!note) throw new AuthError(404,"Lesson note not found");
   if (!admin && !noteOwnerReader(req) && Number(note.teacherUserId) !== context.user.id) throw new AuthError(404,"Lesson note not found");
  return { note, admin };
}
router.get("/schools/:schoolId/lesson-notes/monitoring", run(async (req,res) => {
  const school = schoolId(req);
  requireSchoolAdmin(req,school);
  const session = asyncId(req.query.sessionId,"sessionId");
  const term = asyncId(req.query.termId,"termId");
  const week = asyncId(req.query.week,"week");
  if (week > 60) throw new AuthError(400,"week must be from 1 to 60");
  if (req.query.status !== undefined && !["MISSING","DRAFT","SUBMITTED","RETURNED","RESUBMITTED","APPROVED","ARCHIVED"].includes(String(req.query.status))) {
    throw new AuthError(400,"status is invalid");
  }
  const result = await monitoringRows(school,session,term,week);
  const rows = result.rows.filter((row: any) =>
    (req.query.teacherId === undefined || Number(row.teacherId) === asyncId(req.query.teacherId,"teacherId")) &&
    (req.query.classId === undefined || Number(row.classId) === asyncId(req.query.classId,"classId")) &&
    (req.query.subjectId === undefined || Number(row.subjectId) === asyncId(req.query.subjectId,"subjectId")) &&
    (req.query.status === undefined || String(row.status) === String(req.query.status)));
  res.json(rows);
}));

router.get("/schools/:schoolId/lesson-notes/:noteId", run(async (req,res) => {
  const school = schoolId(req);
   requireNoteRead(req,school);
  const { note } = await getPrivateNote(req,school,requestParam(req,"noteId"));
  const reviews = await pool.query(
    `SELECT id,lesson_note_id AS "noteId",decision,comment,reviewer_user_id AS "reviewerUserId",note_revision AS "noteRevision",created_at AS "createdAt"
       FROM lesson_note_reviews WHERE lesson_note_id=$1 AND school_id=$2 ORDER BY created_at,id`,
    [note.id,school],
  );
  const { teacherUserId: _teacherUserId, ...publicNote } = note;
  res.json({ ...await addPinnedVersion(publicNote),reviews:reviews.rows });
}));

router.patch("/schools/:schoolId/lesson-notes/:noteId", run(async (req,res) => {
  const school = schoolId(req);
  requireSchoolTeacher(req,school);
  const noteId = requestParam(req,"noteId");
  const input = lessonInput(bodyObject(req.body),true);
  const client = await pool.connect();
  let updated;
  try {
    await client.query("BEGIN");
    const { note,admin } = await getPrivateNote(req,school,noteId,true,client);
    if (admin) throw new AuthError(403,"Only the owning teacher may edit lesson-note content");
    if (!["DRAFT","RETURNED"].includes(note.status)) throw new AuthError(409,"Only a teacher-owned draft or returned lesson note may be edited");
    if (input.expectedRevision === undefined) throw new AuthError(400,"expectedRevision is required to prevent overwriting a concurrent edit");
    try { assertRevision(input.expectedRevision,Number(note.revision)); } catch (error) { throw new AuthError(409,(error as Error).message); }
    const final = {
      sessionId:input.sessionId ?? Number(note.sessionId),termId:input.termId ?? Number(note.termId),
      classId:input.classId ?? Number(note.classId),subjectId:input.subjectId ?? Number(note.subjectId),
      section:input.section === undefined ? note.section : input.section,
    };
    await validateTeacherAssignment(school,getUserContext(req).user.id,final.sessionId,final.termId,final.classId,final.subjectId,final.section);
    const merged = {
      ...input,
      sessionId:final.sessionId,termId:final.termId,classId:final.classId,subjectId:final.subjectId,section:final.section,
      week:input.week ?? Number(note.week),date:input.date ?? note.date,
      curriculumMappingId:input.curriculumMappingId === undefined ? note.curriculumMappingId : input.curriculumMappingId,
      curriculumVersionId:input.curriculumVersionId === undefined ? note.curriculumVersionId : input.curriculumVersionId,
      topicId:input.topicId === undefined ? note.topicId : input.topicId,
      subTopicId:input.subTopicId === undefined ? note.subTopicId : input.subTopicId,
      content:input.content === undefined ? note.content : input.content,
    };
    await ensureNoteContext(school,merged,getUserContext(req).user.id,undefined,note);
     const attached = await client.query(`SELECT id FROM lesson_note_documents
       WHERE lesson_note_id=$1 AND school_id=$2 AND status='READY' LIMIT 1`,[noteId,school]);
     if (attached.rows.length && JSON.stringify(lessonDocumentContext({ ...merged,schoolId:school,teacherId:note.teacherId })) !==
         JSON.stringify(lessonDocumentContext(note)))
       throw new AuthError(409,"A PDF is already linked to this academic context. Create a separate note to change its class, subject, period or topic.");
    updated = await client.query(
      `UPDATE lesson_notes SET academic_session_id=$1,academic_term_id=$2,school_class_id=$3,subject_id=$4,section=$5,
         week=$6,lesson_date=$7,curriculum_mapping_id=$8,curriculum_version_id=$9,topic_id=$10,sub_topic_id=$11,
         content=$12::jsonb,revision=revision+1,updated_at=now()
       WHERE id=$13 AND school_id=$14 AND revision=$15 RETURNING ${noteReturning}`,
      [merged.sessionId,merged.termId,merged.classId,merged.subjectId,merged.section,merged.week,merged.date,
        merged.curriculumMappingId,merged.curriculumVersionId,merged.topicId,merged.subTopicId,JSON.stringify(merged.content),
        noteId,school,note.revision],
    );
    if (!updated.rows[0]) throw new AuthError(409,"Lesson note changed during this edit; reload and retry");
    await audit(req,school,"Updated lesson-note draft",noteId,client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.json(await addPinnedVersion(updated!.rows[0]));
}));

async function transitionNote(req: Request, school: number, noteId: number, action: LessonNoteAction, expected: unknown, comment: string | null) {
  const client = await pool.connect();
  let changed;
  try {
    await client.query("BEGIN");
    const { note,admin } = await getPrivateNote(req,school,noteId,true,client);
    if (expected === undefined) throw new AuthError(400,"expectedRevision is required to prevent overwriting a concurrent change");
    try { assertRevision(expected,Number(note.revision)); } catch (error) { throw new AuthError(409,(error as Error).message); }
    const effectiveAction: LessonNoteAction = action === "SUBMIT" && note.status === "RETURNED" ? "RESUBMIT" : action;
    if ((effectiveAction === "SUBMIT" || effectiveAction === "RESUBMIT") && admin) throw new AuthError(403,"Only the owning teacher may submit lesson notes");
    if ((effectiveAction === "RETURN" || effectiveAction === "APPROVE" || effectiveAction === "ARCHIVE") && !admin) throw new AuthError(403,"School Admin review access is required");
    if ((effectiveAction === "RETURN" || effectiveAction === "APPROVE") && Number(note.teacherUserId) === getUserContext(req).user.id) {
      throw new AuthError(403,"A School Admin cannot review their own lesson note");
    }
    if ((effectiveAction === "SUBMIT" || effectiveAction === "RESUBMIT") && !admin) {
       const pdf = await client.query(`SELECT id FROM lesson_note_documents
         WHERE lesson_note_id=$1 AND school_id=$2 AND status='READY' LIMIT 1`,[noteId,school]);
       if (!pdf.rows.length) {
         try { assertLessonNoteSubmittable(note.content ?? {}); } catch (error) { throw new AuthError(400,(error as Error).message); }
       } else if (!note.topicId || !note.curriculumMappingId) throw new AuthError(400,"PDF lesson notes require a selected curriculum topic");
    }
    let nextStatus: LessonNoteStatus;
    try { nextStatus = transitionLessonNote(note.status as LessonNoteStatus,effectiveAction); }
    catch (error) { throw new AuthError(409,(error as Error).message); }
    if (effectiveAction === "RETURN" && !comment?.trim()) throw new AuthError(400,"A return comment is required");
    const context = getUserContext(req);
    changed = await client.query(
      `UPDATE lesson_notes SET status=$1,revision=revision+1,
         submitted_at=CASE WHEN $1 IN ('SUBMITTED','RESUBMITTED') THEN now() ELSE submitted_at END,
         approved_at=CASE WHEN $1='APPROVED' THEN now() ELSE approved_at END,updated_at=now()
       WHERE id=$2 AND school_id=$3 AND revision=$4 RETURNING ${noteReturning}`,
      [nextStatus,noteId,school,note.revision],
    );
    if (!changed.rows[0]) throw new AuthError(409,"Lesson note changed during transition; reload and retry");
    if (effectiveAction === "RETURN" || effectiveAction === "APPROVE") {
      await client.query(
        `INSERT INTO lesson_note_reviews(school_id,lesson_note_id,reviewer_user_id,decision,comment,note_revision)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [school,noteId,context.user.id,effectiveAction === "RETURN" ? "RETURN" : "APPROVE",comment,Number(note.revision)+1],
      );
    }
    if (effectiveAction === "SUBMIT" || effectiveAction === "RESUBMIT") {
      const admins = await client.query(
        `SELECT user_id AS "userId" FROM school_memberships WHERE school_id=$1 AND role='SCHOOL_ADMIN' AND status='ACTIVE'`,
        [school],
      );
      for (const adminRow of admins.rows) {
        await notifyUser(client,Number(adminRow.userId),school,Number(note.classId),`lesson-note-submitted:${noteId}:${Number(note.revision)+1}`,
          "Lesson note submitted for review",`A weekly lesson note was submitted for ${note.week}.`);
      }
    } else if (effectiveAction === "RETURN" || effectiveAction === "APPROVE") {
      if (note.teacherUserId != null) {
        await notifyUser(client,Number(note.teacherUserId),school,Number(note.classId),`lesson-note-${nextStatus.toLowerCase()}:${noteId}:${Number(note.revision)+1}`,
          effectiveAction === "RETURN" ? "Lesson note returned for correction" : "Lesson note approved",
          effectiveAction === "RETURN" ? `A School Admin returned your week ${note.week} lesson note: ${comment!.trim()}` : `Your week ${note.week} lesson note was approved.`);
      }
    }
    await audit(req,school,`Lesson note ${effectiveAction.toLowerCase()}`,noteId,client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  return addPinnedVersion(changed!.rows[0]);
}
router.post("/schools/:schoolId/lesson-notes/:noteId/submit", run(async (req,res) => {
  const school = schoolId(req);
  requireTeacherOrAdmin(req,school);
  const body = bodyObject(req.body ?? {});
  const updated = await transitionNote(req,school,requestParam(req,"noteId"),"SUBMIT",body.expectedRevision,null);
  res.json(updated);
}));

router.post("/schools/:schoolId/lesson-notes/:noteId/pdf-uploads", run(async (req,res) => {
  const school = schoolId(req), noteId = requestParam(req,"noteId");
  requireSchoolTeacher(req,school);
  const body = bodyObject(req.body);
  const file = validateLessonPdfMetadata(body.filename,body.byteSize);
  const client = await pool.connect();
  let document: any, uploadUrl: string;
  try {
    await client.query("BEGIN");
    const { note,admin } = await getPrivateNote(req,school,noteId,true,client);
    if (admin || noteOwnerReader(req) || !["DRAFT","RETURNED"].includes(note.status)) throw new AuthError(409,"Only the owning Teacher can upload to a draft or returned note");
    if (body.expectedRevision !== note.revision) throw new AuthError(409,"The lesson note changed; reload before uploading");
    if (!note.topicId || !note.curriculumMappingId) throw new AuthError(400,"Select and save the curriculum topic before uploading a PDF");
    await validateTeacherAssignment(school,getUserContext(req).user.id,note.sessionId,note.termId,note.classId,note.subjectId,note.section);
    const paths = lessonPdfPaths(school,noteId);
    uploadUrl = await signLessonPdfUpload(paths.stagingPath);
    document = (await client.query(`INSERT INTO lesson_note_documents
      (school_id,lesson_note_id,note_revision,filename,byte_size,staging_path,object_path,context,uploaded_by,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,now()+interval '3 minutes') RETURNING id`,
      [school,noteId,note.revision,file.filename,file.size,paths.stagingPath,paths.objectPath,
        JSON.stringify(lessonDocumentContext(note)),getUserContext(req).user.id])).rows[0];
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  res.status(201).json({ uploadId:document.id,uploadUrl:uploadUrl!,maxBytes:10485760 });
}));
router.post("/schools/:schoolId/lesson-notes/:noteId/pdf-uploads/:uploadId/confirm", run(async (req,res) => {
  const school = schoolId(req),noteId = requestParam(req,"noteId"),uploadId = requestParam(req,"uploadId");
  requireSchoolTeacher(req,school);
  const client = await pool.connect();
  let noteResponse: any;
  try {
    await client.query("BEGIN");
    const { note,admin } = await getPrivateNote(req,school,noteId,true,client);
    if (admin || noteOwnerReader(req)) throw new AuthError(403,"Only the owning Teacher can confirm a PDF");
    const document = (await client.query(`SELECT * FROM lesson_note_documents
      WHERE id=$1 AND lesson_note_id=$2 AND school_id=$3 AND uploaded_by=$4 FOR UPDATE`,
      [uploadId,noteId,school,getUserContext(req).user.id])).rows[0];
    if (!document) throw new AuthError(404,"Lesson-note upload not found");
    if (document.status === "READY") { noteResponse = note; }
    else {
      if (!["DRAFT","RETURNED"].includes(note.status) || Number(document.note_revision)!==Number(note.revision) ||
          new Date(document.expires_at).getTime()<Date.now()) throw new AuthError(409,"This upload expired or the note changed; start a new upload");
      await validateTeacherAssignment(school,getUserContext(req).user.id,note.sessionId,note.termId,note.classId,note.subjectId,note.section);
      const sha = await finalizeLessonPdf(document.staging_path,document.object_path,document.byte_size);
      await client.query(`UPDATE lesson_note_documents SET status='READY',sha256=$1,ready_at=now(),
        note_revision=$2 WHERE id=$3`,[sha,Number(note.revision)+1,uploadId]);
      noteResponse = (await client.query(`UPDATE lesson_notes SET revision=revision+1,updated_at=now()
        WHERE id=$1 AND school_id=$2 RETURNING ${noteReturning}`,[noteId,school])).rows[0];
      await audit(req,school,"Attached validated lesson-note PDF version",noteId,client);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  const { teacherUserId:_private,...result } = noteResponse;
  res.json(await addPinnedVersion(result));
}));
router.get("/schools/:schoolId/lesson-notes/:noteId/documents/:documentId", run(async (req,res) => {
  const school = schoolId(req),noteId = requestParam(req,"noteId"),documentId = requestParam(req,"documentId");
  requireNoteRead(req,school);
  await getPrivateNote(req,school,noteId);
  const document = (await pool.query(`SELECT filename,object_path,sha256 FROM lesson_note_documents
    WHERE id=$1 AND school_id=$2 AND lesson_note_id=$3 AND status='READY'`,[documentId,school,noteId])).rows[0];
  if (!document) throw new AuthError(404,"Lesson-note PDF not found");
  const [bytes] = await lessonPdfFile(document.object_path).download();
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Cache-Control","private, no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Content-Disposition",`inline; filename="lesson-note-${documentId}.pdf"; filename*=UTF-8''${encodeURIComponent(document.filename)}`);
  res.send(bytes);
}));
router.post("/schools/:schoolId/lesson-notes/:noteId/review", run(async (req,res) => {
  const school = schoolId(req);
  requireSchoolAdmin(req,school);
  const body = bodyObject(req.body);
  const decision = requiredText(body.decision,"decision",20);
  if (!["APPROVE","RETURN"].includes(decision)) throw new AuthError(400,"decision must be APPROVE or RETURN");
  const comment = optionalText(body.comment,"comment",5000);
  const updated = await transitionNote(req,school,requestParam(req,"noteId"),decision === "APPROVE" ? "APPROVE" : "RETURN",body.expectedRevision,comment);
  const reviews = await pool.query(`SELECT id,lesson_note_id AS "noteId",decision,comment,reviewer_user_id AS "reviewerUserId",note_revision AS "noteRevision",created_at AS "createdAt"
    FROM lesson_note_reviews WHERE lesson_note_id=$1 AND school_id=$2 ORDER BY created_at,id`,[requestParam(req,"noteId"),school]);
  res.json({...updated,reviews:reviews.rows});
}));
router.post("/schools/:schoolId/lesson-notes/:noteId/archive", run(async (req,res) => {
  const school = schoolId(req);
  requireSchoolAdmin(req,school);
  const body = bodyObject(req.body ?? {});
  const updated = await transitionNote(req,school,requestParam(req,"noteId"),"ARCHIVE",body.expectedRevision,null);
  res.json(updated);
}));

async function monitoringRows(school: number, session: number, term: number, week: number) {
  return pool.query(
    `WITH expected AS (
       SELECT DISTINCT e.id AS teacher_id,e.first_name,e.last_name,c.id AS class_id,s.id AS subject_id,
          NULLIF(c.section,'') AS section,ac.id AS academic_session_id,t.id AS academic_term_id
       FROM employees e JOIN school_classes c ON c.school_id=e.school_id
       JOIN subjects s ON s.school_id=e.school_id
       JOIN academic_sessions ac ON ac.id=$2 AND ac.school_id=e.school_id
       JOIN academic_terms t ON t.id=$3 AND t.academic_session_id=ac.id AND t.school_id=e.school_id
       WHERE e.school_id=$1 AND e.employee_type='TEACHER' AND e.employment_status='ACTIVE'
         AND ${lessonTeachingScope(["$1","$2","$3","c.id","s.id","e.id","COALESCE(c.section,'')"])}
     )
     SELECT x.teacher_id AS "teacherId",concat_ws(' ',x.first_name,x.last_name) AS "teacherName",
       x.class_id AS "classId",x.subject_id AS "subjectId",x.academic_session_id AS "sessionId",
       x.academic_term_id AS "termId",$4::integer AS week,n.id AS "noteId",COALESCE(n.status,'MISSING') AS status
     FROM expected x
     LEFT JOIN LATERAL (
       SELECT n0.id,n0.status FROM lesson_notes n0 WHERE n0.school_id=$1
         AND n0.teacher_employee_id=x.teacher_id AND n0.school_class_id=x.class_id AND n0.subject_id=x.subject_id
         AND n0.academic_session_id=x.academic_session_id AND n0.academic_term_id=x.academic_term_id
         AND n0.week=$4 AND n0.section IS NOT DISTINCT FROM x.section
       ORDER BY n0.updated_at DESC,n0.id DESC LIMIT 1
     ) n ON true
     ORDER BY "teacherName",x.class_id,x.subject_id`,
    [school,session,term,week],
  );
}
router.post("/schools/:schoolId/lesson-notes/reminders", run(async (req,res) => {
  const school = schoolId(req);
  requireSchoolAdmin(req,school);
  const body = bodyObject(req.body);
  const session = asyncId(body.sessionId,"sessionId");
  const term = asyncId(body.termId,"termId");
  const week = asyncId(body.week,"week");
  if (week > 60) throw new AuthError(400,"week must be from 1 to 60");
  const expected = await monitoringRows(school,session,term,week);
  const client = await pool.connect();
  let queuedCount = 0;
  try {
    await client.query("BEGIN");
    for (const row of expected.rows) {
      if (!["MISSING","DRAFT","RETURNED"].includes(String(row.status))) continue;
      const recipient = await client.query(`SELECT user_id FROM employees WHERE id=$1 AND school_id=$2 AND employment_status='ACTIVE'`,[row.teacherId,school]);
      if (!recipient.rows[0]?.user_id) continue;
      const queued = await queueCommunicationNotification(client,{
        recipientUserId:Number(recipient.rows[0].user_id),schoolId:school,subjectClassId:Number(row.classId),category:"ACADEMIC",
        eventKey:`weekly-lesson-note-reminder:${school}:${session}:${term}:${week}:${row.teacherId}:${row.classId}:${row.subjectId}`,
        subject:"Weekly lesson note reminder",body:`Please prepare and submit the lesson note for week ${week}.`,
        link:"/academics/lesson-notes",channels:["IN_APP"],
      });
      if (queued != null) queuedCount += 1;
    }
    await audit(req,school,"Queued weekly lesson-note reminders",week,client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.json({queuedCount});
}));

export default router;