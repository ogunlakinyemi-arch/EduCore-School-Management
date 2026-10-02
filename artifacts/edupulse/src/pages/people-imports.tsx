import { useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, FileSpreadsheet, FileText, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { PageHeading, Button, Field, TenantPicker, useTenant } from "@/components/shared";
import {
  ImportPreviewTable,
  ImportSection,
  ImportSummaryCard,
  type ImportPreviewRow,
} from "@/components/import-preview-table";

type ImportKind = "students" | "parents" | "teachers" | "staff";
type SchoolClass = { id: number; name: string; section: string };
type InspectResponse = {
  columns: string[];
  classes: SchoolClass[];
  filename: string;
  detectedType: "csv" | "xlsx" | "pdf";
};
type PreviewResponse = InspectResponse & {
  previewId: string;
  kind: ImportKind;
  detected: number;
  counts: { ready: number; potentialDuplicates: number; duplicates: number; invalid: number };
  classValues: string[];
  rows: ImportPreviewRow[];
};
type ImportResult = {
  detected: number;
  imported: number;
  skipped: number;
  failed: number;
  results: Array<{
    index: number;
    sourceRow: number;
    status: "IMPORTED" | "FAILED" | "SKIPPED";
    recordId?: number;
    message?: string;
  }>;
};

const fields: Record<ImportKind, Array<{ key: string; label: string; required?: boolean; aliases: string[] }>> = {
  students: [
    { key: "admissionNo", label: "Admission number (optional; generated when blank)", aliases: ["admissionno", "admissionnumber", "admissionid", "studentid"] },
    { key: "firstName", label: "First name", required: true, aliases: ["firstname", "givenname"] },
    { key: "middleName", label: "Middle name", aliases: ["middlename", "othernames"] },
    { key: "lastName", label: "Last name", required: true, aliases: ["lastname", "surname", "familyname"] },
    { key: "dateOfBirth", label: "Date of birth", aliases: ["dateofbirth", "dob", "birthdate"] },
    { key: "admissionDate", label: "Admission date", aliases: ["admissiondate", "dateadmitted"] },
    { key: "gender", label: "Gender", required: true, aliases: ["gender", "sex"] },
    { key: "className", label: "Class / grade", required: true, aliases: ["class", "classname", "grade", "yeargroup"] },
    { key: "section", label: "Section", aliases: ["section", "arm", "stream"] },
    { key: "parentName", label: "Parent / guardian name", aliases: ["parentname", "guardianname"] },
    { key: "parentEmail", label: "Parent / guardian email", aliases: ["parentemail", "guardianemail"] },
    { key: "parentPhone", label: "Parent / guardian phone", aliases: ["parentphone", "guardianphone", "phone"] },
    { key: "parentRelationshipType", label: "Parent relationship", aliases: ["parentrelationship", "relationship"] },
    { key: "address", label: "Address", aliases: ["address", "homeaddress"] },
    { key: "status", label: "Student status", aliases: ["status", "studentstatus"] },
  ],
  parents: [
    { key: "name", label: "Parent / guardian name", required: true, aliases: ["name", "parentname", "guardianname", "fullname"] },
    { key: "email", label: "Email address", required: true, aliases: ["email", "parentemail", "guardianemail"] },
    { key: "phone", label: "Phone number", required: true, aliases: ["phone", "phonenumber", "parentphone", "guardianphone"] },
    { key: "address", label: "Address", aliases: ["address", "homeaddress"] },
    { key: "admissionNo", label: "Student admission number", aliases: ["admissionno", "admissionnumber", "studentadmissionno"] },
    { key: "relationshipType", label: "Relationship to student", aliases: ["relationship", "relationshiptype", "parentrelationship"] },
  ],
  teachers: [
    { key: "employeeId", label: "Staff / employee ID", required: true, aliases: ["employeeid", "employeeno", "staffid", "teacherid"] },
    { key: "firstName", label: "First name", required: true, aliases: ["firstname", "givenname"] },
    { key: "middleName", label: "Middle name", aliases: ["middlename", "othernames"] },
    { key: "lastName", label: "Last name", required: true, aliases: ["lastname", "surname", "familyname"] },
    { key: "email", label: "Email address", aliases: ["email", "emailaddress"] },
    { key: "phone", label: "Phone number", aliases: ["phone", "phonenumber", "mobile"] },
    { key: "department", label: "Department", aliases: ["department", "faculty"] },
    { key: "qualification", label: "Qualification", aliases: ["qualification", "certification"] },
    { key: "type", label: "Employee type", aliases: ["type", "employeetype", "roletype"] },
  ],
  staff: [
    { key: "employeeId", label: "Staff / employee ID", required: true, aliases: ["employeeid", "employeeno", "staffid"] },
    { key: "firstName", label: "First name", required: true, aliases: ["firstname", "givenname"] },
    { key: "middleName", label: "Middle name", aliases: ["middlename", "othernames"] },
    { key: "lastName", label: "Last name", required: true, aliases: ["lastname", "surname", "familyname"] },
    { key: "email", label: "Email address", aliases: ["email", "emailaddress"] },
    { key: "phone", label: "Phone number", aliases: ["phone", "phonenumber", "mobile"] },
    { key: "department", label: "Department", aliases: ["department", "faculty"] },
    { key: "qualification", label: "Qualification", aliases: ["qualification", "certification"] },
    { key: "type", label: "Employee type", aliases: ["type", "employeetype"] },
  ],
};

const titles: Record<ImportKind, string> = {
  students: "Students",
  parents: "Parents & guardians",
  teachers: "Teachers",
  staff: "Staff",
};

const templates: Record<ImportKind, string[]> = {
  students: ["Admission Number,First Name,Middle Name,Last Name,Date of Birth,Admission Date,Gender,Class,Section,Parent Name,Parent Email,Parent Phone,Parent Relationship,Address", "STU-0001,Ada,,Okafor,2015-06-12,2026-01-05,female,Primary 5,Emerald,Grace Okafor,grace@example.com,08012345678,Mother,Example Street"],
  parents: ["Parent Name,Email,Phone,Address,Student Admission Number,Relationship", "Grace Okafor,grace@example.com,08012345678,Example Street,STU-0001,Mother"],
  teachers: ["Employee ID,First Name,Middle Name,Last Name,Email,Phone,Department,Qualification,Type", "TCH-0001,Ade,,Bello,ade@example.com,08012345678,Science,BEd,TEACHER"],
  staff: ["Employee ID,First Name,Middle Name,Last Name,Email,Phone,Department,Qualification,Type", "STF-0001,Chi,,Okoro,chi@example.com,08012345678,Operations,,STAFF"],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function suggestedMapping(kind: ImportKind, columns: string[]): Record<string, string> {
  const normalizedColumns = new Map(columns.map((column) => [normalize(column), column]));
  const mapping: Record<string, string> = {};
  for (const field of fields[kind]) {
    const match = field.aliases.map((alias) => normalizedColumns.get(alias)).find(Boolean);
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

function saveCsv(filename: string, content: string) {
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  return fallback;
}

async function postMultipart<T>(path: string, schoolId: number, form: FormData): Promise<T> {
  const response = await fetch(`/api/people/imports/${path}?schoolId=${schoolId}`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiError(data, `Import request failed (${response.status})`));
  return data as T;
}

function makeForm(file: File, kind: ImportKind) {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", file, file.name);
  return form;
}

export function PeopleImportsPage() {
  const { schoolId } = useTenant();
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ImportKind>("students");
  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<InspectResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [classMapping, setClassMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [validatedMappings, setValidatedMappings] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [includePotentialDuplicates, setIncludePotentialDuplicates] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"inspect" | "preview" | "confirm" | "classes" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const hasUnmappedClasses = !!preview && kind === "students" &&
    preview.classValues.some((value) => !classMapping[value]);
  const selectedPotentialDuplicate = !!preview && preview.rows.some((row) =>
    selectedRows.has(row.index) && row.status === "POTENTIAL_DUPLICATE",
  );
  const mappingsAreCurrent = validatedMappings === JSON.stringify({ mapping, classMapping });
  const canConfirm = !!preview && mappingsAreCurrent && selectedRows.size > 0 && !busy && !hasUnmappedClasses &&
    (!selectedPotentialDuplicate || includePotentialDuplicates);

  const visibleFields = useMemo(() => fields[kind], [kind]);

  function resetFor(kindValue: ImportKind, nextFile = file) {
    setKind(kindValue);
    setFile(nextFile);
    setInspect(null);
    setMapping({});
    setClassMapping({});
    setPreview(null);
    setValidatedMappings(null);
    setSelectedRows(new Set());
    setIncludePotentialDuplicates(false);
    setResult(null);
    setError("");
    setSuccess("");
  }

  async function inspectFile() {
    if (!schoolId || !file) return;
    setBusy("inspect");
    setError("");
    setSuccess("");
    setPreview(null);
    setValidatedMappings(null);
    setResult(null);
    try {
      const response = await postMultipart<InspectResponse>("inspect", schoolId, makeForm(file, kind));
      setInspect(response);
      setMapping(suggestedMapping(kind, response.columns));
      setClassMapping({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not inspect this file");
    } finally {
      setBusy(null);
    }
  }

  async function validatePreview() {
    if (!schoolId || !file || !inspect) return;
    setValidatedMappings(null);
    setBusy("preview");
    setError("");
    setSuccess("");
    setResult(null);
    try {
      const form = makeForm(file, kind);
      form.set("mapping", JSON.stringify(mapping));
      form.set("classMapping", JSON.stringify(classMapping));
      const next = await postMultipart<PreviewResponse>("preview", schoolId, form);
      setPreview(next);
      setValidatedMappings(JSON.stringify({ mapping, classMapping }));
      setSelectedRows(new Set(next.rows
        .filter((row) => row.status === "READY" || row.status === "POTENTIAL_DUPLICATE")
        .map((row) => row.index)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not validate this file");
    } finally {
      setBusy(null);
    }
  }

  async function confirmImport() {
    if (!schoolId || !preview || !canConfirm) return;
    setBusy("confirm");
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/people/imports/confirm?schoolId=${schoolId}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          previewId: preview.previewId,
          selectedRows: [...selectedRows],
          includePotentialDuplicates,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiError(data, `Import could not be confirmed (${response.status})`));
      setResult(data as ImportResult);
      setPreview(null);
      setSuccess("Import completed. The results below include rows that were skipped or failed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete this import");
    } finally {
      setBusy(null);
    }
  }

  function downloadErrorReport() {
    if (preview) {
      const header = ["Source row", "Status", "Field", "Issue", "Values"];
      const records = preview.rows.flatMap((row) => {
        const issues = [
          ...row.errors.map((issue) => ({ ...issue, status: "INVALID" })),
          ...row.warnings.map((issue) => ({ ...issue, status: row.status })),
        ];
        return (issues.length ? issues : [{ message: "", field: "", status: row.status }]).map((issue) => [
          row.sourceRow, issue.status, issue.field ?? "", issue.message ?? "",
          JSON.stringify(row.values),
        ]);
      });
      saveCsv("import-preview-review.csv", [header, ...records].map((row) => row.map(csvCell).join(",")).join("\r\n"));
    } else if (result) {
      const header = ["Source row", "Result", "Record ID", "Reason"];
      const records = result.results.filter((row) => row.status !== "IMPORTED").map((row) =>
        [row.sourceRow, row.status, row.recordId ?? "", row.message ?? ""],
      );
      saveCsv("import-results-errors.csv", [header, ...records].map((row) => row.map(csvCell).join(",")).join("\r\n"));
    }
  }

  function downloadTemplate() {
    saveCsv(`${kind}-import-template.csv`, templates[kind].join("\r\n"));
  }

  return (
    <div className="fade-up space-y-6">
      <PageHeading
        eyebrow="School operations / Data import"
        title="Bulk import."
        description="Upload school records, map your columns, review validation and duplicates, then explicitly confirm the selected rows."
        action={<TenantPicker />}
      />

      {!schoolId ? (
        <div className="panel p-6 text-sm text-[hsl(var(--muted-foreground))]">
          Select your school context before importing records.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200">
            <ShieldCheck size={15} />
            The server scopes every preview and write to your authenticated School Administrator membership. School IDs, roles, and account IDs in uploaded files are never imported.
          </div>

          {error && <div role="alert" className="rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)] p-4 text-sm text-[hsl(var(--destructive))]">{error}</div>}
          {success && <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-800 dark:text-emerald-200">{success}</div>}

          <ImportSection
            title="1. Choose records and upload a file"
            description="CSV and XLSX are supported. Text-based PDFs are parsed only when the table layout is clear; scanned PDFs are rejected rather than guessed."
          >
            <div className="grid gap-4 md:grid-cols-[minmax(0,250px)_1fr_auto] md:items-end">
              <Field label="Records to import">
                <select
                  value={kind}
                  disabled={!!busy}
                  onChange={(event) => resetFor(event.target.value as ImportKind)}
                  className="w-full rounded-xl"
                >
                  {(Object.keys(titles) as ImportKind[]).map((value) => <option key={value} value={value}>{titles[value]}</option>)}
                </select>
              </Field>
              <Field label="CSV, XLSX, or readable PDF (maximum 5 MB)">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,.xlsx,.pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
                  disabled={!!busy}
                  onChange={(event) => {
                    const chosen = event.target.files?.[0] ?? null;
                    setFile(chosen);
                    setInspect(null);
                    setPreview(null);
                    setResult(null);
                    setClassMapping({});
                    setError("");
                    setSuccess("");
                  }}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-[hsl(var(--secondary))] file:px-3 file:py-2 file:text-xs file:font-bold"
                />
              </Field>
              <Button onClick={inspectFile} disabled={!file || !!busy}>
                <Upload size={15} />{busy === "inspect" ? "Reading file…" : "Inspect file"}
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button variant="outline" onClick={downloadTemplate}><ArrowDownToLine size={15} />Download {titles[kind].toLowerCase()} CSV template</Button>
              {file && <span className="inline-flex items-center gap-2 self-center text-xs text-[hsl(var(--muted-foreground))]"><FileText size={14} />{file.name}</span>}
            </div>
          </ImportSection>

          {inspect && !result && (
            <>
              <ImportSection title="2. Map uploaded columns" description="Map only fields you recognize. System-owned identity, role, and school fields are not available for import.">
                <div className="mb-4 text-sm font-semibold">
                  <FileSpreadsheet className="mr-2 inline" size={16} />
                  {inspect.filename} · {inspect.detectedType.toUpperCase()} · {inspect.columns.length} source columns
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleFields.map((field) => (
                    <Field key={field.key} label={`${field.label}${field.required ? " *" : ""}`}>
                      <select
                        value={mapping[field.key] ?? ""}
                        onChange={(event) => setMapping((old) => ({ ...old, [field.key]: event.target.value }))}
                        className="w-full rounded-xl"
                      >
                        <option value="">Not mapped</option>
                        {inspect.columns.map((column) => <option key={column} value={column}>{column}</option>)}
                      </select>
                    </Field>
                  ))}
                </div>
                {kind === "students" && (
                  <div className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.2)] p-4 text-xs text-[hsl(var(--muted-foreground))]">
                    Class names are matched to classes already configured for the selected school. After the first validation, map each uploaded class/section to the correct existing class; unknown classes are never created automatically.
                  </div>
                )}
                <div className="mt-5 flex justify-end">
                  <Button onClick={validatePreview} disabled={!!busy}>
                    <Check size={15} />{busy === "preview" ? "Validating…" : preview ? "Validate updated mappings" : "Validate and preview"}
                  </Button>
                </div>
              </ImportSection>

              {preview && (
                <>
                  {kind === "students" && preview.classValues.length > 0 && (
                    <ImportSection
                      title="Map uploaded classes"
                      description="Choose the existing Yemait EduCore class/section that each uploaded class value represents."
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        {preview.classValues.map((value) => (
                          <Field key={value} label={`Uploaded class: ${value}`}>
                            <select
                              value={classMapping[value] ?? ""}
                              onChange={(event) => setClassMapping((old) => ({
                                ...old,
                                [value]: event.target.value ? Number(event.target.value) : 0,
                              }))}
                              className="w-full rounded-xl"
                            >
                              <option value="">Choose an existing class</option>
                              {preview.classes.map((item) => (
                                <option key={item.id} value={item.id}>{item.name} · {item.section}</option>
                              ))}
                            </select>
                          </Field>
                        ))}
                      </div>
                      {hasUnmappedClasses && (
                        <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">
                          Choose a class for every uploaded value, then select “Validate updated mappings” to refresh the preview.
                        </p>
                      )}
                    </ImportSection>
                  )}

                  <ImportSection
                    title="3. Review rows before import"
                    description="Correct the source file or mappings and validate again. Existing duplicates and invalid rows cannot be selected for creation."
                  >
                    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <ImportSummaryCard label="Detected rows" count={preview.detected} />
                      <ImportSummaryCard label="Ready" count={preview.counts.ready} tone="good" />
                      <ImportSummaryCard label="Possible duplicates" count={preview.counts.potentialDuplicates} tone="warning" />
                      <ImportSummaryCard label="Duplicates / invalid" count={preview.counts.duplicates + preview.counts.invalid} tone="danger" />
                    </div>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">{selectedRows.size} row(s) selected for explicit confirmation</span>
                      <div className="flex flex-wrap gap-2">
                        {preview.rows.some((row) => row.status === "READY" || row.status === "POTENTIAL_DUPLICATE") && (
                          <Button variant="quiet" onClick={() => setSelectedRows(new Set(preview.rows
                            .filter((row) => row.status === "READY" || row.status === "POTENTIAL_DUPLICATE")
                            .map((row) => row.index)))}>Select importable rows</Button>
                        )}
                        <Button variant="outline" onClick={downloadErrorReport}><ArrowDownToLine size={14} />Download review report</Button>
                      </div>
                    </div>
                    <ImportPreviewTable
                      rows={preview.rows}
                      selected={selectedRows}
                      onToggle={(index) => setSelectedRows((old) => {
                        const next = new Set(old);
                        if (next.has(index)) next.delete(index);
                        else next.add(index);
                        return next;
                      })}
                      selectionLocked={!!busy}
                    />
                    {selectedPotentialDuplicate && (
                      <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
                        <input
                          type="checkbox"
                          checked={includePotentialDuplicates}
                          onChange={(event) => setIncludePotentialDuplicates(event.target.checked)}
                          className="mt-0.5 accent-[hsl(var(--primary))]"
                        />
                        <span>I reviewed the flagged name/date-of-birth matches and explicitly approve creating the selected records as new students.</span>
                      </label>
                    )}
                    <div className="mt-5 flex flex-col justify-between gap-3 border-t border-[hsl(var(--border))] pt-4 sm:flex-row sm:items-center">
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        Rows not selected are skipped. Each selected row is saved independently; a row failure does not undo other successful rows.
                      </span>
                      <Button onClick={confirmImport} disabled={!canConfirm}>
                        <ArrowRight size={15} />{busy === "confirm" ? "Importing…" : "Confirm import"}
                      </Button>
                    </div>
                  </ImportSection>
                </>
              )}
            </>
          )}

          {result && (
            <ImportSection title="4. Import result" description="Download a row-level report for every skipped or failed record.">
              <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <ImportSummaryCard label="Detected" count={result.detected} />
                <ImportSummaryCard label="Imported" count={result.imported} tone="good" />
                <ImportSummaryCard label="Skipped" count={result.skipped} tone="warning" />
                <ImportSummaryCard label="Failed" count={result.failed} tone="danger" />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={downloadErrorReport}><ArrowDownToLine size={14} />Download error report</Button>
                <Button variant="quiet" onClick={() => {
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = "";
                  setInspect(null);
                  setPreview(null);
                  setResult(null);
                  setMapping({});
                  setClassMapping({});
                  setError("");
                  setSuccess("");
                }}><RotateCcw size={14} />Start another import</Button>
              </div>
              {result.failed > 0 && (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead><tr className="border-b border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"><th className="p-2">Row</th><th className="p-2">Result</th><th className="p-2">Reason</th></tr></thead>
                    <tbody>{result.results.filter((row) => row.status !== "IMPORTED").map((row) => (
                      <tr key={row.index} className="border-b border-[hsl(var(--border)/.6)]"><td className="p-2">{row.sourceRow}</td><td className="p-2">{row.status}</td><td className="p-2">{row.message}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </ImportSection>
          )}

          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Imported parent/guardian records do not receive login credentials. Account invitations are handled separately; uploaded roles never grant portal access.
          </p>
        </>
      )}
    </div>
  );
}