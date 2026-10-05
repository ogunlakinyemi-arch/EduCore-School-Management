import { inflateRawSync } from "node:zlib";
import { spawnSync } from "node:child_process";

export const IMPORT_KINDS = ["students", "parents", "teachers", "staff"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export type ImportStatus = "READY" | "INVALID" | "DUPLICATE" | "POTENTIAL_DUPLICATE";

export type ImportRow = {
  sourceRow: number;
  values: Record<string, string>;
};

export type ImportIssue = { field?: string; message: string };
export type PreparedImportRow = {
  index: number;
  sourceRow: number;
  values: Record<string, unknown>;
  status: ImportStatus;
  errors: ImportIssue[];
  warnings: ImportIssue[];
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 3000;
const MAX_COLUMNS = 50;
const MAX_XML_BYTES = 12 * 1024 * 1024;

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => decodeXmlCodePoint(n, 16))
    .replace(/&#([0-9]+);/g, (_, n: string) => decodeXmlCodePoint(n, 10))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function decodeXmlCodePoint(value: string, radix: number): string {
  const codePoint = parseInt(value, radix);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    throw new Error("The XLSX workbook contains an invalid XML character reference");
  }
  return String.fromCodePoint(codePoint);
}

export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;
  const pushCell = () => {
    row.push(cell.trim());
    cell = "";
    if (row.length > MAX_COLUMNS) throw new Error(`Files may have at most ${MAX_COLUMNS} columns`);
  };
  const pushRow = () => {
    if (row.some((item) => item !== "")) {
      rows.push(row);
      if (rows.length > MAX_ROWS + 1) throw new Error(`Files may contain at most ${MAX_ROWS} data rows`);
    }
    row = [];
  };
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        cell += char;
      }
    } else if (afterQuote && char !== "," && char !== "\r" && char !== "\n" && char !== " " && char !== "\t") {
      throw new Error("The CSV file contains characters after a quoted field");
    } else if (char === ",") {
      pushCell();
      afterQuote = false;
    } else if (char === '"') {
      if (cell.trim()) throw new Error("The CSV file contains a quote inside an unquoted field");
      quoted = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      pushCell();
      pushRow();
      afterQuote = false;
    } else {
      if (!afterQuote) cell += char;
    }
  }
  if (quoted) throw new Error("The CSV file contains an unclosed quoted field");
  pushCell();
  pushRow();
  return rows;
}

function rowsToObjects(rows: string[][]): ImportRow[] {
  if (rows.length < 2) throw new Error("Include a header row and at least one data row");
  const headers = rows[0].map((header) => header.trim());
  if (!headers.length || headers.some((header) => !header)) {
    throw new Error("Every source column needs a header");
  }
  if (headers.length > MAX_COLUMNS) throw new Error(`Files may have at most ${MAX_COLUMNS} columns`);
  if (new Set(headers.map((header) => header.toLocaleLowerCase())).size !== headers.length) {
    throw new Error("Column headers must be unique");
  }
  if (rows.length - 1 > MAX_ROWS) throw new Error(`Files may contain at most ${MAX_ROWS} data rows`);
  return rows.slice(1).map((values, index) => {
    if (values.length > headers.length) throw new Error(`Source row ${index + 2} contains more values than the header row`);
    return {
      sourceRow: index + 2,
      values: Object.fromEntries(headers.map((header, column) => [header, (values[column] ?? "").trim()])),
    };
  });
}

export function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("The XLSX file is not a valid ZIP workbook");
  }
  let eocd = -1;
  const lower = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= lower; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("The XLSX workbook directory could not be read");
  const entriesCount = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  let cursor = buffer.readUInt32LE(eocd + 16);
  if (entriesCount > 2000 || directorySize > 1024 * 1024 || cursor + directorySize > buffer.length) {
    throw new Error("The XLSX workbook has an unsupported ZIP directory");
  }
  const wanted = new Set(["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml"]);
  const result = new Map<string, Buffer>();
  let inflatedTotal = 0;
  for (let i = 0; i < entriesCount; i += 1) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("The XLSX workbook directory is malformed");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength).replaceAll("\\", "/");
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > eocd) throw new Error("The XLSX workbook directory is truncated");
    cursor = next;
    if (!wanted.has(name) && !/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    if (compressedSize > MAX_FILE_BYTES || uncompressedSize > MAX_XML_BYTES) {
      throw new Error("The XLSX workbook contains an oversized XML component");
    }
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("The XLSX workbook contains an invalid component");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > buffer.length) throw new Error("The XLSX workbook component is truncated");
    const compressed = buffer.subarray(start, end);
    let content: Buffer;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) {
      try {
        content = inflateRawSync(compressed, { maxOutputLength: MAX_XML_BYTES });
      } catch {
        throw new Error("The XLSX workbook contains corrupt or oversized compressed XML");
      }
    }
    else throw new Error("The XLSX workbook uses an unsupported compression method");
    if (content.length !== uncompressedSize) throw new Error("The XLSX workbook component size is invalid");
    inflatedTotal += content.length;
    if (inflatedTotal > MAX_XML_BYTES) throw new Error("The XLSX workbook expands beyond the safe processing limit");
    result.set(name, content);
  }
  return result;
}

function parseXmlCellValue(xml: string, shared: string[]): string {
  const type = xml.match(/\bt="([^"]+)"/)?.[1];
  const value = xml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= shared.length) return "";
    return shared[index];
  }
  if (type === "inlineStr") {
    return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
  }
  return decodeXml(value);
}

export function parseXlsx(buffer: Buffer): ImportRow[] {
  const entries = readZipEntries(buffer);
  const forbiddenXml = [...entries.values()].some((xml) => /<!DOCTYPE|<!ENTITY/i.test(xml.toString("utf8")));
  if (forbiddenXml) throw new Error("The XLSX workbook contains unsupported XML declarations");
  const worksheetName = [...entries.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!worksheetName) throw new Error("The XLSX workbook has no readable worksheet");
  const sharedXml = entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((item) =>
    [...item[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((part) => decodeXml(part[1]))
      .join(""),
  );
  const sheetXml = entries.get(worksheetName)!.toString("utf8");
  const rawRows: string[][] = [];
  for (const match of sheetXml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<number, string>();
    for (const cell of match[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
      const attrs = cell[1] ?? cell[3] ?? "";
      const reference = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      if (!reference) continue;
      let column = 0;
      for (const char of reference) column = column * 26 + char.charCodeAt(0) - 64;
      if (column > MAX_COLUMNS) throw new Error(`Files may have at most ${MAX_COLUMNS} columns`);
      cells.set(column - 1, parseXmlCellValue(`${attrs}>${cell[2] ?? ""}`, shared));
    }
    const max = Math.max(-1, ...cells.keys());
    const row = Array.from({ length: max + 1 }, (_, index) => cells.get(index) ?? "");
    if (row.some((value) => value.trim() !== "")) {
      rawRows.push(row);
      if (rawRows.length > MAX_ROWS + 1) throw new Error(`Files may contain at most ${MAX_ROWS} data rows`);
    }
  }
  return rowsToObjects(rawRows);
}

function parsePdfTextTable(text: string): ImportRow[] {
  const lines = text.replace(/\f/g, "\n").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) => /first\s*name|admission\s*(no|number)|parent\s*name|employee\s*(id|no)/i.test(line));
  if (!candidate) throw new Error("This PDF has no reliably readable table header. Use an Excel or CSV template instead.");
  const delimiter = candidate.includes("|") ? "|" : candidate.includes("\t") ? "\t" : null;
  const split = (line: string) => {
    const values = delimiter ? line.split(delimiter) : line.split(/\s{2,}/);
    return values.map((value) => value.trim()).filter((value) => value !== "");
  };
  const header = split(candidate);
  if (header.length < 2) throw new Error("The PDF table layout is ambiguous. Use an Excel or CSV template instead.");
  const rows = [header];
  let started = false;
  for (const line of lines.slice(lines.indexOf(candidate) + 1)) {
    const values = split(line);
    if (values.length === header.length) {
      rows.push(values);
      started = true;
    } else if (started) {
      break;
    }
  }
  if (rows.length < 2) throw new Error("No reliably readable PDF table records were detected. Use an Excel or CSV template instead.");
  return rowsToObjects(rows);
}

export function extractReadablePdf(buffer: Buffer): string {
  const extracted = spawnSync("pdftotext", ["-layout", "-", "-"], {
    input: buffer,
    encoding: "utf8",
    timeout: 8_000,
    maxBuffer: MAX_XML_BYTES,
    windowsHide: true,
  });
  if (extracted.error || extracted.status !== 0) {
    throw new Error("The PDF could not be safely read. Use an Excel or CSV template instead.");
  }
  const text = extracted.stdout.trim();
  if (text.length < 24 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new Error("This PDF appears scanned or has no reliably extractable table text. Use Excel or CSV instead.");
  }
  return text;
}

export function parseImportFile(file: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): { rows: ImportRow[]; detectedType: "csv" | "xlsx" | "pdf" } {
  if (!file.buffer.length || file.buffer.length > MAX_FILE_BYTES) {
    throw new Error(`The upload must be between 1 byte and ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  const extension = file.filename.toLocaleLowerCase().split(".").pop();
  const mime = file.mimeType.toLocaleLowerCase().split(";")[0].trim();
  if (extension === "csv" && ["text/csv", "application/csv", "application/vnd.ms-excel", "application/octet-stream"].includes(mime)) {
    if (file.buffer.includes(0)) throw new Error("The CSV upload contains binary data");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(file.buffer);
    } catch {
      throw new Error("The CSV upload must contain valid UTF-8 text");
    }
    return { rows: rowsToObjects(parseCsv(text)), detectedType: "csv" };
  }
  if (
    extension === "xlsx" &&
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"].includes(mime) &&
    file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  ) {
    return { rows: parseXlsx(file.buffer), detectedType: "xlsx" };
  }
  if (
    extension === "pdf" &&
    ["application/pdf", "application/octet-stream"].includes(mime) &&
    file.buffer.subarray(0, 5).toString("ascii") === "%PDF-"
  ) {
    return { rows: parsePdfTextTable(extractReadablePdf(file.buffer)), detectedType: "pdf" };
  }
  if (["csv", "xlsx", "pdf"].includes(extension ?? "")) {
    throw new Error("The file extension, MIME type, and file contents do not agree");
  }
  throw new Error("Only CSV, XLSX, and readable text PDF files are supported");
}

export function normalizeHeader(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function mapSourceRows(
  rows: ImportRow[],
  mapping: Record<string, string>,
  forbiddenFields: string[] = ["schoolId", "school_id", "tenantId", "tenant_id", "userId", "user_id", "role"],
): Array<{ sourceRow: number; values: Record<string, string> }> {
  const forbidden = new Set(forbiddenFields.map(normalizeHeader));
  for (const target of Object.keys(mapping)) {
    if (forbidden.has(normalizeHeader(target))) throw new Error(`The ${target} field is assigned by the server and cannot be imported`);
  }
  return rows.map((row) => ({
    sourceRow: row.sourceRow,
    values: Object.fromEntries(
      Object.entries(mapping).map(([field, source]) => [field, row.values[source] ?? ""]),
    ),
  }));
}

export type SchoolClass = { id: number; name: string; section: string };
export type ImportExisting = {
  students: Array<{ admissionNo: string; firstName: string; lastName: string; dateOfBirth: string | null }>;
  parents: Array<{ name: string; email: string; phone: string }>;
  employees: Array<{ employeeId: string; firstName: string; lastName: string; email: string | null }>;
  studentAdmissions: string[];
};

const requiredByKind: Record<ImportKind, string[]> = {
  students: ["firstName", "lastName", "gender", "className"],
  parents: ["name", "email", "phone"],
  teachers: ["employeeId", "firstName", "lastName"],
  staff: ["employeeId", "firstName", "lastName"],
};

function cell(values: Record<string, string>, key: string): string {
  return (values[key] ?? "").trim();
}

function dateOnly(value: string): string | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (date.toISOString().slice(0, 10) === `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`) {
      return date.toISOString().slice(0, 10);
    }
    return null;
  }
  const local = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (local) {
    const [month, day, year] = [Number(local[1]), Number(local[2]), Number(local[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return date.toISOString().slice(0, 10);
    }
    return null;
  }
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const dayNumber = Number(value);
    if (dayNumber > 0 && dayNumber < 100_000) {
      return new Date(Date.UTC(1899, 11, 30) + dayNumber * 86_400_000).toISOString().slice(0, 10);
    }
  }
  return null;
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function classSourceValue(className: string, section: string): string {
  return section ? `${className.trim()} / ${section.trim()}` : className.trim();
}

export function prepareImportRows(input: {
  kind: ImportKind;
  rows: Array<{ sourceRow: number; values: Record<string, string> }>;
  classMapping?: Record<string, number>;
  classes: SchoolClass[];
  existing: ImportExisting;
}): PreparedImportRow[] {
  const classById = new Map(input.classes.map((item) => [item.id, item]));
  const withinFile = new Set<string>();
  return input.rows.map(({ sourceRow, values }, index) => {
    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    const prepared: Record<string, unknown> = {};
    const fail = (field: string, message: string) => errors.push({ field, message });
    for (const required of requiredByKind[input.kind]) {
      if (!cell(values, required)) fail(required, "This field is required");
    }
    if (input.kind === "students") {
      const admissionNo = cell(values, "admissionNo");
      const gender = cell(values, "gender").toLocaleLowerCase();
      const className = cell(values, "className");
      const rawSection = cell(values, "section");
      const sourceClass = classSourceValue(className, rawSection);
      const chosenClassId = input.classMapping?.[sourceClass];
      const chosenClass = chosenClassId ? classById.get(Number(chosenClassId)) : undefined;
      if (gender && !["female", "male", "other"].includes(gender)) fail("gender", "Use female, male, or other");
      if (className && !chosenClass) fail("className", "Map this uploaded class to an existing school class and section");
      const dateOfBirthInput = cell(values, "dateOfBirth");
      const dateOfBirth = dateOfBirthInput ? dateOnly(dateOfBirthInput) : null;
      if (dateOfBirthInput && !dateOfBirth) fail("dateOfBirth", "Use YYYY-MM-DD, M/D/YYYY, or a valid Excel date");
      const admissionDateInput = cell(values, "admissionDate");
      const admissionDate = admissionDateInput ? dateOnly(admissionDateInput) : null;
      if (admissionDateInput && !admissionDate) fail("admissionDate", "Use YYYY-MM-DD, M/D/YYYY, or a valid Excel date");
      const parentEmail = cell(values, "parentEmail").toLocaleLowerCase();
      if (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) fail("parentEmail", "Enter a valid parent email address");
      const importedParentName = cell(values, "parentName");
      const importedParentPhone = cell(values, "parentPhone");
      if (parentEmail && !(importedParentName && importedParentPhone)) {
        warnings.push({ field: "parentEmail", message: "Parent name and phone are required to link this student; this row will import without a parent link" });
      } else if (parentEmail) {
        const existingParent = input.existing.parents.find((item) =>
          normalizeIdentifier(item.email ?? "") === normalizeIdentifier(parentEmail));
        if (existingParent && (
          normalizeIdentifier(existingParent.name) !== normalizeIdentifier(importedParentName) ||
          String(existingParent.phone).replace(/\D/g, "") !== importedParentPhone.replace(/\D/g, "")
        )) {
          warnings.push({ field: "parentEmail", message: "Existing parent email does not match the uploaded name and phone; this student will import without a parent link" });
        }
      }
      const parentRelationshipType = cell(values, "parentRelationshipType") || "Guardian";
      if (!["Father", "Mother", "Guardian", "Grandparent", "Other"].includes(parentRelationshipType)) {
        fail("parentRelationshipType", "Choose a supported parent relationship");
      }
      const key = normalizeIdentifier(admissionNo);
      if (key && withinFile.has(key)) warnings.push({ field: "admissionNo", message: "Duplicate admission number in this upload; will be skipped" });
      if (key) withinFile.add(key);
      if (key && input.existing.students.some((item) => normalizeIdentifier(item.admissionNo) === key)) {
        warnings.push({ field: "admissionNo", message: "Admission number already exists in this school; will be skipped" });
      } else if (
        cell(values, "firstName") && cell(values, "lastName") && dateOfBirth &&
        input.existing.students.some((item) =>
          normalizeIdentifier(item.firstName) === normalizeIdentifier(cell(values, "firstName")) &&
          normalizeIdentifier(item.lastName) === normalizeIdentifier(cell(values, "lastName")) &&
          item.dateOfBirth === dateOfBirth,
        )
      ) {
        warnings.push({ field: "dateOfBirth", message: "A student with the same name and date of birth exists; review before importing as new" });
      }
      const status = cell(values, "status").toLocaleUpperCase() || "ACTIVE";
      if (status && !["ACTIVE", "INACTIVE", "GRADUATED", "TRANSFERRED", "WITHDRAWN"].includes(status)) {
        fail("status", "Unsupported student status");
      }
      Object.assign(prepared, {
        admissionNo: admissionNo || null,
        admissionNoSource: admissionNo ? "PRESERVED" : "GENERATED",
        firstName: cell(values, "firstName"),
        middleName: cell(values, "middleName") || null,
        lastName: cell(values, "lastName"),
        dateOfBirth,
        admissionDate,
        gender,
        className: chosenClass?.name ?? className,
        section: chosenClass?.section ?? rawSection,
        parentName: cell(values, "parentName") || null,
        parentEmail: parentEmail || null,
        parentPhone: cell(values, "parentPhone") || null,
        parentRelationshipType,
        address: cell(values, "address") || null,
        status,
      });
    } else if (input.kind === "parents") {
      const email = cell(values, "email").toLocaleLowerCase();
      const phone = cell(values, "phone");
      const admissionNo = cell(values, "admissionNo");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("email", "Enter a valid email address");
      if (phone && phone.replace(/\D/g, "").length < 7) fail("phone", "Enter a phone number with at least 7 digits");
      if (admissionNo && !input.existing.studentAdmissions.some((item) => normalizeIdentifier(item) === normalizeIdentifier(admissionNo))) {
        fail("admissionNo", "No student with this admission number exists in this school");
      }
      const parentKey = normalizeIdentifier(email);
      const parentIdentity = `${normalizeIdentifier(cell(values, "name"))}|${normalizeIdentifier(phone)}`;
      if ((parentKey && withinFile.has(`email:${parentKey}`)) || (parentIdentity !== "|" && withinFile.has(`identity:${parentIdentity}`))) {
        warnings.push({ field: "email", message: "Duplicate parent details in this upload; will be skipped" });
      }
      if (parentKey) withinFile.add(`email:${parentKey}`);
      if (parentIdentity !== "|") withinFile.add(`identity:${parentIdentity}`);
      if (input.existing.parents.some((item) =>
        normalizeIdentifier(item.email) === normalizeIdentifier(email) ||
        (normalizeIdentifier(item.name) === normalizeIdentifier(cell(values, "name")) && normalizeIdentifier(item.phone) === normalizeIdentifier(phone)),
      )) warnings.push({ field: "email", message: "A matching parent already exists in this school; this row will be skipped" });
      const relationship = cell(values, "relationshipType") || "Guardian";
      if (!["Father", "Mother", "Guardian", "Grandparent", "Other"].includes(relationship)) fail("relationshipType", "Choose a supported relationship");
      Object.assign(prepared, {
        name: cell(values, "name"),
        email,
        phone,
        address: cell(values, "address") || null,
        admissionNo: admissionNo || null,
        relationshipType: relationship,
      });
    } else {
      const employeeId = cell(values, "employeeId");
      const email = cell(values, "email").toLocaleLowerCase();
      const type = (cell(values, "type") || (input.kind === "teachers" ? "TEACHER" : "STAFF")).toLocaleUpperCase();
      const key = normalizeIdentifier(employeeId);
      const expectedType = input.kind === "teachers" ? "TEACHER" : "STAFF";
      if (type !== expectedType) fail("type", `This import may only create ${expectedType} records`);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("email", "Enter a valid email address");
      if (key && withinFile.has(`id:${key}`)) warnings.push({ field: "employeeId", message: "Duplicate employee ID in this upload; will be skipped" });
      if (key) withinFile.add(`id:${key}`);
      const emailKey = normalizeIdentifier(email);
      if (emailKey && withinFile.has(`email:${emailKey}`)) {
        warnings.push({ field: "email", message: "Duplicate employee email in this upload; will be skipped" });
      }
      if (emailKey) withinFile.add(`email:${emailKey}`);
      if (key && input.existing.employees.some((item) => normalizeIdentifier(item.employeeId) === key)) {
        warnings.push({ field: "employeeId", message: "Employee ID already exists in this school; will be skipped" });
      } else if (email && input.existing.employees.some((item) => normalizeIdentifier(item.email ?? "") === normalizeIdentifier(email))) {
        warnings.push({ field: "email", message: "This email already exists on a school employee; will be skipped" });
      }
      Object.assign(prepared, {
        employeeId,
        firstName: cell(values, "firstName"),
        middleName: cell(values, "middleName") || null,
        lastName: cell(values, "lastName"),
        type,
        phone: cell(values, "phone") || null,
        email: email || null,
        department: cell(values, "department") || null,
        qualification: cell(values, "qualification") || null,
      });
    }
    const duplicate = warnings.some((warning) => warning.message.includes("already exists") || warning.message.includes("Duplicate "));
    const potentialDuplicate = warnings.some((warning) => warning.message.includes("same name and date of birth"));
    return {
      index,
      sourceRow,
      values: prepared,
      errors,
      warnings,
      status: errors.length ? "INVALID" : duplicate ? "DUPLICATE" : potentialDuplicate ? "POTENTIAL_DUPLICATE" : "READY",
    };
  });
}