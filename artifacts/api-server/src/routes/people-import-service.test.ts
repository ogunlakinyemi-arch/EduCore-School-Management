import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  mapSourceRows,
  parseCsv,
  parseImportFile,
  parseXlsx,
  prepareImportRows,
} from "./people-import-service";

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = Buffer.from(name);
    const raw = Buffer.from(text);
    const compressed = deflateRawSync(raw);
    const checksum = crc32(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directoryBuffer = Buffer.concat(directory);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(directoryBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryBuffer, eocd]);
}

function textPdf(lines: Array<Array<[number, string]>>): Buffer {
  const content = Buffer.from(lines.flatMap((cells, row) =>
    cells.map(([x, text]) => `BT /F1 12 Tf ${x} ${700 - row * 20} Td (${text}) Tj ET`),
  ).join("\n") + "\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("endstream")]),
  ];
  let output = Buffer.from("%PDF-1.4\n");
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(output.length);
    output = Buffer.concat([output, Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from("\nendobj\n")]);
  });
  const xref = output.length;
  output = Buffer.concat([output, Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)]);
  offsets.slice(1).forEach((offset) => {
    output = Buffer.concat([output, Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`)]);
  });
  return Buffer.concat([output, Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]);
}

describe("people import parsers and row validation", () => {
  it("parses a real selectable-text PDF table through pdftotext before preview", () => {
    const result = parseImportFile({
      filename: "students.pdf",
      mimeType: "application/pdf",
      buffer: textPdf([
        [[50, "Admission No"], [210, "First Name"], [370, "Last Name"]],
        [[50, "A-1"], [210, "Ada"], [370, "Okafor"]],
      ]),
    });
    expect(result).toEqual({
      detectedType: "pdf",
      rows: [{ sourceRow: 2, values: { "Admission No": "A-1", "First Name": "Ada", "Last Name": "Okafor" } }],
    });
  });

  it("rejects a PDF with no selectable table text rather than inventing records", () => {
    expect(() => parseImportFile({
      filename: "scanned.pdf",
      mimeType: "application/pdf",
      buffer: textPdf([]),
    })).toThrow(/scanned|readable/i);
  });

  it("parses quoted CSV cells, commas, escaped quotes, and CRLF safely", () => {
    expect(parseCsv('Name,Note\r\n"Doe, Jane","said ""hello"""\r\n')).toEqual([
      ["Name", "Note"],
      ["Doe, Jane", 'said "hello"'],
    ]);
    expect(() => parseCsv('Name,Note\nJane,"missing quote')).toThrow("unclosed quoted field");
    expect(() => parseCsv('Name,Note\nJane,said "hello"')).toThrow("quote inside");
    expect(() => parseCsv('Name,Note\nJane,"ok"oops')).toThrow("characters after");
    expect(() => parseImportFile({
      buffer: Buffer.from("Name\nAda,extra\n"),
      filename: "bad.csv",
      mimeType: "text/csv",
    })).toThrow("more values than the header row");
  });

  it("extracts first worksheet headers and shared string cells from an in-memory XLSX", () => {
    const workbook = zip({
      "xl/sharedStrings.xml": '<sst><si><t>Admission No</t></si><si><t>First Name</t></si><si><t>Last Name</t></si><si><t>Primary 5</t></si><si><t>AB-9</t></si><si><t>Rina</t></si><si><t>Okafor</t></si></sst>',
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" t="s"><v>6</v></c><c r="D2" t="inlineStr"><is><t>Emerald</t></is></c></row></sheetData></worksheet>',
    });
    expect(parseXlsx(workbook)).toEqual([{
      sourceRow: 2,
      values: { "Admission No": "AB-9", "First Name": "Rina", "Last Name": "Okafor", "Primary 5": "Emerald" },
    }]);
    const invalidEntity = zip({
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&#99999999;</t></is></c></row></sheetData></worksheet>',
    });
    expect(() => parseXlsx(invalidEntity)).toThrow("invalid XML character");
    expect(() => parseImportFile({
      buffer: workbook,
      filename: "students.xlsx",
      mimeType: "text/csv",
    })).toThrow("do not agree");
  });

  it("rejects school IDs, tenant IDs, account IDs, and roles as imported mapping targets", () => {
    const rows = [{ sourceRow: 2, values: { Tenant: "2", Name: "A" } }];
    expect(() => mapSourceRows(rows, { schoolId: "Tenant" })).toThrow("server and cannot be imported");
    expect(() => mapSourceRows(rows, { role: "Name" })).toThrow("server and cannot be imported");
    expect(() => mapSourceRows(rows, { user_id: "Tenant" })).toThrow("server and cannot be imported");
  });

  it("validates required student fields and maps classes only to a configured school class", () => {
    const mapped = mapSourceRows([
      { sourceRow: 2, values: { Admission: "A-1", First: "Amara", Last: "Okafor", Gender: "female", Class: "P1", Section: "Blue" } },
      { sourceRow: 3, values: { Admission: "", First: "Tolu", Last: "Ayo", Gender: "unknown", Class: "P9", Section: "" } },
    ], {
      admissionNo: "Admission",
      firstName: "First",
      lastName: "Last",
      gender: "Gender",
      className: "Class",
      section: "Section",
    });
    const result = prepareImportRows({
      kind: "students",
      rows: mapped,
      classMapping: { "P1 / Blue": 10 },
      classes: [{ id: 10, name: "Primary 1", section: "Blue" }],
      existing: { students: [], parents: [], employees: [], studentAdmissions: [] },
    });
    expect(result[0].status).toBe("READY");
    expect(result[0].values.className).toBe("Primary 1");
    expect(result[0].values.section).toBe("Blue");
    expect(result[1].status).toBe("INVALID");
    expect(result[1].errors.map((error) => error.field)).toContain("gender");
    expect(result[1].errors.map((error) => error.field)).toContain("className");
  });

  it("marks a missing admission number for generation and preserves a supplied valid number", () => {
    const result = prepareImportRows({
      kind: "students",
      rows: [
        { sourceRow: 2, values: { admissionNo: "", firstName: "Ada", lastName: "Okafor", gender: "female", className: "P1" } },
        { sourceRow: 3, values: { admissionNo: "OLD-007", firstName: "Tolu", lastName: "Ayo", gender: "male", className: "P1" } },
      ],
      classMapping: { P1: 10 },
      classes: [{ id: 10, name: "Primary 1", section: "Blue" }],
      existing: { students: [], parents: [], employees: [], studentAdmissions: [] },
    });
    expect(result.map(row => row.status)).toEqual(["READY", "READY"]);
    expect(result[0].values).toMatchObject({ admissionNo: null, admissionNoSource: "GENERATED" });
    expect(result[1].values).toMatchObject({ admissionNo: "OLD-007", admissionNoSource: "PRESERVED" });
  });

  it("marks existing identifiers as skip-only duplicates and name/date matches as explicit-review duplicates", () => {
    const mapped = mapSourceRows([
      { sourceRow: 2, values: { Admission: "A-1", First: "Ada", Last: "Nwosu", Gender: "female", Class: "P1", DOB: "2015-03-04" } },
      { sourceRow: 3, values: { Admission: "A-2", First: "Ada", Last: "Nwosu", Gender: "female", Class: "P1", DOB: "2015-03-04" } },
    ], {
      admissionNo: "Admission",
      firstName: "First",
      lastName: "Last",
      gender: "Gender",
      className: "Class",
      dateOfBirth: "DOB",
    });
    const result = prepareImportRows({
      kind: "students",
      rows: mapped,
      classMapping: { P1: 10 },
      classes: [{ id: 10, name: "Primary 1", section: "Blue" }],
      existing: {
        students: [
          { admissionNo: "A-1", firstName: "Other", lastName: "Name", dateOfBirth: null },
          { admissionNo: "A-3", firstName: "Ada", lastName: "Nwosu", dateOfBirth: "2015-03-04" },
        ],
        parents: [],
        employees: [],
        studentAdmissions: [],
      },
    });
    expect(result[0].status).toBe("DUPLICATE");
    expect(result[1].status).toBe("POTENTIAL_DUPLICATE");
  });

  it("marks duplicate employee IDs in the same upload and rejects arbitrary employee types", () => {
    const result = prepareImportRows({
      kind: "staff",
      rows: [
        { sourceRow: 2, values: { employeeId: "S-1", firstName: "Abel", lastName: "One", type: "OWNER" } },
        { sourceRow: 3, values: { employeeId: "s-1", firstName: "Bola", lastName: "Two" } },
      ],
      classes: [],
      existing: { students: [], parents: [], employees: [], studentAdmissions: [] },
    });
    expect(result[0].status).toBe("INVALID");
    expect(result[0].errors.map((error) => error.field)).toContain("type");
    expect(result[1].status).toBe("DUPLICATE");
  });

  it("skips repeated employee email even when IDs differ", () => {
    const rows = prepareImportRows({
      kind: "teachers",
      rows: [
        { sourceRow: 2, values: { employeeId: "T-1", firstName: "Ada", lastName: "One", email: "ADA@school.test" } },
        { sourceRow: 3, values: { employeeId: "T-2", firstName: "Ada", lastName: "Two", email: "ada@school.test" } },
      ],
      classes: [],
      existing: { students: [], parents: [], employees: [], studentAdmissions: [] },
    });
    expect(rows[0].status).toBe("READY");
    expect(rows[1].status).toBe("DUPLICATE");
    expect(rows[1].warnings.some((issue) => issue.field === "email")).toBe(true);
  });

  it("warns rather than trusting a mismatched parent email for student linkage", () => {
    const rows = prepareImportRows({
      kind: "students",
      rows: [{ sourceRow: 2, values: {
        admissionNo: "A-1", firstName: "A", lastName: "B", gender: "female",
        className: "P1", parentEmail: "parent@school.test", parentName: "Wrong Name", parentPhone: "08011111111",
      } }],
      classMapping: { P1: 10 },
      classes: [{ id: 10, name: "Primary 1", section: "Blue" }],
      existing: {
        students: [], employees: [], studentAdmissions: [],
        parents: [{ name: "Real Name", email: "parent@school.test", phone: "08022222222" }],
      },
    });
    expect(rows[0].warnings.some((issue) => issue.message.includes("without a parent link"))).toBe(true);
  });

  it("accepts only bounded supported file formats whose signature and MIME match", () => {
    expect(parseImportFile({
      buffer: Buffer.from("Name,Email\nGrace,grace@example.com"),
      filename: "parents.csv",
      mimeType: "text/csv",
    }).detectedType).toBe("csv");
    expect(() => parseImportFile({
      buffer: Buffer.from("%PDF-1.4"),
      filename: "scan.pdf",
      mimeType: "application/pdf",
    })).toThrow();
    expect(() => parseImportFile({
      buffer: Buffer.from("not a workbook"),
      filename: "records.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })).toThrow("contents do not agree");
    expect(() => parseImportFile({
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      filename: "large.csv",
      mimeType: "text/csv",
    })).toThrow("5 MB");
  });
});