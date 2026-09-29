import { deflateRawSync } from "node:zlib";
import { AuthError } from "../../middlewares/auth";
import type { ReportResult } from "./core";

export type ReportExportFormat = "csv" | "xlsx" | "pdf";

export type SerializedReportExport = {
  body: Buffer;
  contentType: string;
  filename: string;
  contentDisposition: string;
};

function cellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value) ?? "";
}

function spreadsheetSafe(value: string): string {
  return /^[\u0000-\u0020\u007f]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvField(value: string): string {
  const escaped = spreadsheetSafe(value).replace(/"/g, '""');
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function csv(result: ReportResult): Buffer {
  const header = result.columns.map((column) => csvField(column.label));
  const records = result.rows.map((row) =>
    result.columns.map((column) => csvField(cellValue(row[column.key]))),
  );
  return Buffer.from(`\uFEFF${[header, ...records].map((record) => record.join(",")).join("\r\n")}`, "utf8");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Array<[string, string]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [path, content] of files) {
    const name = Buffer.from(path, "utf8");
    const data = Buffer.from(content, "utf8");
    const checksum = crc32(data);
    const compressed = deflateRawSync(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function xlsx(result: ReportResult): Buffer {
  const rows = [
    result.columns.map((column) => column.label),
    ...result.rows.map((row) =>
      result.columns.map((column) => cellValue(row[column.key])),
    ),
  ];
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const safeValue = spreadsheetSafe(value);
      const address = `${columnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(safeValue)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`],
  ]);
}

function pdfText(value: string): string {
  return value.normalize("NFKD").replace(/[^\x20-\x7e]/g, "?");
}

function pdfEscape(value: string): string {
  return pdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdf(result: ReportResult): Buffer {
  const lines = [pdfText(result.title), result.columns.map((column) => column.label).join(" | "), ""];
  for (const row of result.rows) {
    const values = result.columns.map((column) => {
      const value = cellValue(row[column.key]).replace(/\s+/g, " ").trim();
      return `${column.label}: ${value}`;
    });
    lines.push(...values, "");
  }

  const pages: string[][] = [];
  let page: string[] = [];
  for (const line of lines) {
    let remaining = line;
    while (remaining.length > 105) {
      const splitAt = remaining.lastIndexOf(" ", 105);
      const end = splitAt > 0 ? splitAt : 105;
      page.push(remaining.slice(0, end));
      remaining = remaining.slice(end).trimStart();
    }
    page.push(remaining);
    if (page.length >= 48) {
      pages.push(page);
      page = [];
    }
  }
  if (page.length || pages.length === 0) pages.push(page);

  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((pageLines, index) => {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    const commands = ["BT", "/F1 9 Tf", "44 752 Td", "12 TL"];
    for (const line of pageLines) commands.push(`(${pdfEscape(line)}) Tj`, "T*");
    commands.push("ET");
    const stream = commands.join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`);
  });

  let document = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document, "ascii"));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(document, "ascii");
}

function safeFilename(title: string, extension: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\w -]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .slice(0, 80) || "report";
  return `${slug}.${extension}`;
}

/** Serialize only the columns declared by the authorized report result. */
export function serializeReportExport(
  format: ReportExportFormat,
  result: ReportResult,
): SerializedReportExport {
  const filename = safeFilename(result.title, format);
  let body: Buffer;
  let contentType: string;
  switch (format) {
    case "csv":
      body = csv(result);
      contentType = "text/csv; charset=utf-8";
      break;
    case "xlsx":
      body = xlsx(result);
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      break;
    case "pdf":
      body = pdf(result);
      contentType = "application/pdf";
      break;
    default:
      throw new AuthError(400, "Export format must be csv, xlsx, or pdf");
  }
  const fallback = filename.replace(/[^\w.-]/g, "_");
  return {
    body,
    contentType,
    filename,
    contentDisposition: `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
}