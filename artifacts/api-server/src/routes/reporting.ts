import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { AuthError, getUserContext, handleAuthError, requireAuthentication } from "../middlewares/auth";
import { activitiesReports } from "./reporting/activities";
import { businessReports } from "./reporting/business";
import { learningReports } from "./reporting/learning";
import { organizationReports } from "./reporting/organization";
import {
  parseReportFilters,
  resolveReportContext,
  type ReportContext,
  type ReportDefinition,
  type ReportFilters,
  type ReportResult,
} from "./reporting/core";
import { serializeReportExport, type ReportExportFormat } from "./reporting/exports";

const router = Router();
router.use("/reports", requireAuthentication());

const reports: Record<string, ReportDefinition> = {
  ...organizationReports,
  ...learningReports,
  ...businessReports,
  ...activitiesReports,
};

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(error => handleAuthError(error, req, res, next));
  };
}

function getDefinition(id: string): ReportDefinition {
  const definition = Object.prototype.hasOwnProperty.call(reports, id) ? reports[id] : undefined;
  if (!definition) throw new AuthError(404, "Report not found");
  return definition;
}

function authorizedFilters(req: Request, definition: ReportDefinition, exportRequest = false): ReportFilters {
  const query = { ...req.query } as Record<string, unknown>;
  if (exportRequest) delete query.format;
  const allowed = new Set(["schoolId", "limit", "offset", ...(definition.filters ?? [])]);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "" && !allowed.has(key)) {
      throw new AuthError(400, `Filter ${key} is not available for this report`);
    }
  }
  return parseReportFilters(query);
}

function visibleResult(result: ReportResult, limit: number): ReportResult {
  const columns = result.columns.filter(column => /^[A-Za-z][\w]*$/.test(column.key));
  const rows = result.rows.slice(0, limit).map(row => Object.fromEntries(
    columns.map(column => [column.key, row[column.key] ?? null]),
  ));
  return { ...result, columns, rows };
}

async function auditReport(req: Request, context: ReportContext, reportId: string, filters: ReportFilters, exported: boolean) {
  const user = getUserContext(req).user;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  await pool.query(
    `INSERT INTO audit_logs ("user",role,actor_user_id,clerk_user_id,school_id,action,module,
      severity,event_type,result,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'Reporting','info',$7,'SUCCESS',$8::jsonb)`,
    [
      displayName,
      context.role === "OWNER" ? "PLATFORM_OWNER" : context.role === "ADMIN" ? "SCHOOL_ADMIN" : context.role,
      user.id,
      user.clerkUserId,
      context.schoolId,
      exported ? "Exported report" : "Viewed report",
      exported ? "REPORT_EXPORT_GENERATED" : "REPORT_VIEWED",
      JSON.stringify({ reportId, filters: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)) }),
    ],
  );
}

router.get("/reports/catalog", asyncRoute(async (req, res) => {
  const filters = parseReportFilters(req.query);
  if (Object.keys(req.query).some(key => key !== "schoolId")) {
    throw new AuthError(400, "Only schoolId is available for report catalogue selection");
  }
  const items: Array<{ id: string; title: string; filters: string[] }> = [];
  for (const [id, definition] of Object.entries(reports)) {
    try {
      await resolveReportContext(req, definition.roles, filters);
      items.push({
        id,
        title: id.split("-").map(word => word[0]?.toUpperCase() + word.slice(1)).join(" "),
        filters: (definition.filters ?? []).filter(key => key !== "limit" && key !== "offset"),
      });
    } catch (error) {
      if (!(error instanceof AuthError) || ![403, 404].includes(error.statusCode)) throw error;
    }
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ items });
}));

router.get("/reports/:reportId/export", asyncRoute(async (req, res) => {
  const definition = getDefinition(req.params.reportId as string);
  const format = req.query.format;
  if (format !== "csv" && format !== "xlsx" && format !== "pdf") {
    throw new AuthError(400, "format must be csv, xlsx, or pdf");
  }
  const filters = authorizedFilters(req, definition, true);
  const context = await resolveReportContext(req, definition.roles, filters);
  const result = visibleResult(await definition.run(context, filters), filters.limit);
  const file = serializeReportExport(format as ReportExportFormat, result);
  await auditReport(req, context, req.params.reportId as string, filters, true);
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", file.contentDisposition);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(file.body);
}));

router.get("/reports/:reportId", asyncRoute(async (req, res) => {
  const definition = getDefinition(req.params.reportId as string);
  const filters = authorizedFilters(req, definition);
  const context = await resolveReportContext(req, definition.roles, filters);
  const result = visibleResult(await definition.run(context, filters), filters.limit);
  await auditReport(req, context, req.params.reportId as string, filters, false);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(result);
}));

export default router;