import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  roles: [] as Array<{ role: string; schoolId: number | null; status: string }>,
  snapshot: null as Record<string, unknown> | null,
  sql: "",
  values: [] as unknown[],
  reads: 0,
}));
const mockPool = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.sql = sql;
    state.values = values;
    state.reads += 1;
    return { rows: state.snapshot ? [state.snapshot] : [], rowCount: state.snapshot ? 1 : 0 };
  }),
}));

vi.mock("@workspace/db", () => ({ pool: mockPool }));
vi.mock("../middlewares/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(public statusCode: number, message: string, public eventType = "ACCESS_DENIED") {
      super(message);
    }
  },
  getUserContext: (req: express.Request) =>
    (req as express.Request & { edupulseUser: { roles: typeof state.roles } }).edupulseUser,
  requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { edupulseUser: { roles: typeof state.roles } }).edupulseUser = { roles: state.roles };
    next();
  },
}));
vi.mock("../lib/nfc-printable-images", () => ({
  loadPrintablePhoto: vi.fn(async () => null),
  loadPrintableSchoolLogo: vi.fn(async () => null),
}));

import printableRouter from "./nfc-printable";
import { buildNfcPrintablePdfSample } from "../lib/nfc-printable-pdf";
vi.mock("../lib/nfc-card-preview", () => ({
  rasterOfficialCard: async () => ({frontImage:"data:image/png;base64,Zm9udA==",backImage:"data:image/png;base64,YmFjaw=="}),
}));

function unicodeMapped(pdf: string, value: string) {
  return Array.from(new Set(Array.from(value))).every((character) => {
    const encoded = Buffer.from(character, "utf16le");
    for (let index = 0; index < encoded.length; index += 2) {
      const byte = encoded[index]!;
      encoded[index] = encoded[index + 1]!;
      encoded[index + 1] = byte;
    }
    return pdf.includes(`<${encoded.toString("hex").toUpperCase()}>`);
  });
}

const studentCard = () => ({
  cardId: 41,
  schoolId: 9,
  cardStatus: "active",
  studentId: 101,
  studentStatus: "active",
  studentName: "Amina Example",
  admissionNo: "PERM-101",
  studentPhoto: null,
  employeeBindingCount: 0,
  employeeId: null,
  employeeType: null,
  employeeStatus: null,
  employeeName: null,
  employeeNo: null,
  employeePhoto: null,
  employeeBindingStatus: null,
  schoolName: "North School",
  schoolRegistrationNumber: null,
  schoolAddress: "1 Main Road",
  schoolCity: "Lagos",
  schoolState: "Lagos",
  schoolPhone: "08000000000",
  schoolEmail: "office@example.test",
  schoolLogo: null,
});

let baseUrl = "";
let server: ReturnType<typeof import("node:http").createServer>;

beforeAll(async () => {
  const app = express();
  app.use(printableRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start printable route test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => error ? reject(error) : resolve())
));
beforeEach(() => {
  vi.clearAllMocks();
  state.roles = [{ role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }];
  state.snapshot = studentCard();
  state.reads = 0;
});

describe("GET /cards/:cardId/printable", () => {
  it("exports an image-rich actual-renderer sample PDF fixture with Yoruba Unicode mapping", async () => {
    const pdf = (await buildNfcPrintablePdfSample()).toString("latin1");
    expect(pdf).toContain("/Count 2");
    expect(pdf).toContain("/MediaBox [0 0 242.6457 153.0142]");
    expect(pdf).toContain("/SchoolLogo");
    expect(pdf).toContain("/PersonPhoto");
    expect(pdf.match(/\/Subtype \/Image/g)).toHaveLength(2);
    expect(pdf).toContain("/Subtype /CIDFontType2");
    expect(unicodeMapped(pdf, "Ọlámidé Ọ̀jọ́")).toBe(true);
    expect(pdf).not.toContain("Academic session");
    expect(pdf).not.toContain("JSS1");
    expect(pdf).not.toContain("/Info");
  });

  it("returns a two-page exact-size PDF for a current permanent student identity without dynamic fields or secrets", async () => {
    const response = await fetch(`${baseUrl}/cards/41/printable?schoolId=9`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const pdf = bytes.toString("latin1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain('attachment; filename="NFC-id-41.pdf"');
    expect(pdf).toContain("/Count 2");
    expect(pdf).toContain("/MediaBox [0 0 242.6457 153.0142]");
    expect(unicodeMapped(pdf, "Amina Example")).toBe(true);
    expect(unicodeMapped(pdf, "PERM-101")).toBe(true);
    expect(unicodeMapped(pdf, "PROPERTY OF YEMAIT TECHNOLOGIES LIMITED")).toBe(true);
    expect(unicodeMapped(pdf, "Yemait EduCore NFC Identification Card")).toBe(true);
    expect(pdf).not.toContain("UID-RAW");
    expect(pdf).not.toContain("private-token");
    expect(pdf).not.toContain("JSS1");
    expect(pdf).not.toContain("Section A");
    expect(pdf).not.toContain("Academic session");
    expect(pdf).not.toContain("/Info");
    expect(state.sql).toContain("nc.id=$1 AND nc.school_id=$2");
    expect(state.sql).not.toMatch(/class_name|section|academic_terms|academic_sessions/i);
    expect(state.values).toEqual([41, 9]);
  });

  it("prints current Teacher data and omits former assignment history from identity selection", async () => {
    state.snapshot = {
      ...studentCard(),
      studentId: null,
      studentStatus: null,
      studentName: null,
      admissionNo: null,
      employeeBindingCount: 1,
      employeeId: 202,
      employeeType: "TEACHER",
      employeeStatus: "ACTIVE",
      employeeName: "Tunde Current",
      employeeNo: "EMP-202",
      employeeBindingStatus: "ACTIVE",
    };
    const response = await fetch(`${baseUrl}/cards/41/printable?schoolId=9`);
    const pdf = Buffer.from(await response.arrayBuffer()).toString("latin1");
    expect(response.status).toBe(200);
    expect(unicodeMapped(pdf, "Tunde Current")).toBe(true);
    expect(unicodeMapped(pdf, "Teacher")).toBe(true);
    expect(unicodeMapped(pdf, "EMP-202")).toBe(true);
    expect(state.sql).not.toContain("employee_nfc_card_history");
  });

  it("allows an assigned-and-locked Teacher card to print without activating it", async () => {
    state.snapshot = {
      ...studentCard(),
      cardStatus: "locked",
      studentId: null,
      studentStatus: null,
      studentName: null,
      admissionNo: null,
      employeeBindingCount: 1,
      employeeId: 202,
      employeeType: "TEACHER",
      employeeStatus: "ACTIVE",
      employeeName: "Tunde Current",
      employeeNo: "EMP-202",
      employeeBindingStatus: "ASSIGNED",
    };
    const response = await fetch(`${baseUrl}/cards/41/printable?schoolId=9`);
    const pdf = Buffer.from(await response.arrayBuffer()).toString("latin1");
    expect(response.status).toBe(200);
    expect(unicodeMapped(pdf, "Tunde Current")).toBe(true);
    expect(state.reads).toBe(1);
    expect(mockPool.query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  });

  it("requires schoolId and rejects malformed ids", async () => {
    expect((await fetch(`${baseUrl}/cards/41/printable`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/cards/0/printable?schoolId=9`)).status).toBe(400);
  });

  it.each(["SCHOOL_ADMIN", "STAFF", "TEACHER", "ACCOUNTANT", "COMPANY_ACCOUNTANT", "DEVICE_ACTIVATION_OFFICER"])(
    "denies %s even when it has school scope",
    async (role) => {
      state.roles = [{ role, schoolId: 9, status: "ACTIVE" }];
      const response = await fetch(`${baseUrl}/cards/41/printable?schoolId=9`);
      expect(response.status).toBe(403);
      expect(state.reads).toBe(0);
    },
  );

  it("returns 404 for a card outside the requested school without reading another school's assignment", async () => {
    state.snapshot = null;
    const response = await fetch(`${baseUrl}/cards/41/printable?schoolId=10`);
    expect(response.status).toBe(404);
    expect(state.values).toEqual([41, 10]);
  });

  it.each([
    { cardStatus: "lost" },
    { cardStatus: "deactivated" },
    { studentStatus: "inactive" },
  ])("fails closed for inactive or revoked current student identity", async (changes) => {
    state.snapshot = { ...studentCard(), ...changes };
    const response = await fetch(`${baseUrl}/cards/41/printable?schoolId=9`);
    expect(response.status).toBe(409);
  });

  it("rejects unbound and conflicting assignments", async () => {
    state.snapshot = { ...studentCard(), studentId: null, studentStatus: null, studentName: null, admissionNo: null };
    expect((await fetch(`${baseUrl}/cards/41/printable?schoolId=9`)).status).toBe(409);
    state.snapshot = { ...studentCard(), employeeBindingCount: 1, employeeId: 202 };
    expect((await fetch(`${baseUrl}/cards/41/printable?schoolId=9`)).status).toBe(409);
  });

  it("rejects unsupported Driver employee bindings with 422", async () => {
    state.snapshot = {
      ...studentCard(),
      studentId: null,
      studentStatus: null,
      employeeBindingCount: 1,
      employeeId: 202,
      employeeType: "DRIVER",
      employeeStatus: "ACTIVE",
      employeeName: "Unsupported Driver",
      employeeNo: "EMP-202",
      employeeBindingStatus: "ACTIVE",
    };
    expect((await fetch(`${baseUrl}/cards/41/printable?schoolId=9`)).status).toBe(422);
  });

  it("prints an eligible Staff assignment with its permanent employee identity", async () => {
    state.snapshot = { ...studentCard(),studentId:null,studentStatus:null,
      employeeBindingCount:1,employeeId:202,employeeType:"STAFF",employeeStatus:"ACTIVE",
      employeeName:"QA Operations Staff",employeeNo:"EMP-202",employeeBindingStatus:"ACTIVE" };
    const response=await fetch(`${baseUrl}/cards/41/printable?schoolId=9`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(unicodeMapped(await response.text(),"QA Operations Staff")).toBe(true);
  });

  it("allows only scoped School Admin raster viewing, not printable PDF", async () => {
    state.roles=[{role:"SCHOOL_ADMIN",schoolId:9,status:"ACTIVE"}];
    const preview=await fetch(`${baseUrl}/cards/41/preview?schoolId=9`);
    expect(preview.status).toBe(200);
    expect((await preview.json() as {frontImage:string}).frontImage).toMatch(/^data:image\/png/);
    expect((await fetch(`${baseUrl}/cards/41/printable?schoolId=9`)).status).toBe(403);
    expect((await fetch(`${baseUrl}/cards/41/preview?schoolId=10`)).status).toBe(403);
  });

  it.each(["PLATFORM_OWNER", "SCHOOL_ADMIN"])("allows %s to preview a locked current Student assignment without activating or printing it", async role => {
    state.roles=[{role,schoolId:role==="PLATFORM_OWNER"?null:9,status:"ACTIVE"}];
    state.snapshot={...studentCard(),cardStatus:"locked"};
    const response=await fetch(`${baseUrl}/cards/41/preview?schoolId=9`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({frontImage:expect.stringMatching(/^data:image\/png/),backImage:expect.stringMatching(/^data:image\/png/)});
    expect(state.values).toEqual([41,9]);
    expect(mockPool.query.mock.calls.every(([sql])=>/^\s*SELECT/i.test(sql))).toBe(true);
    expect(state.snapshot.cardStatus).toBe("locked");
    expect((await fetch(`${baseUrl}/cards/41/printable?schoolId=9`)).status).toBe(role==="PLATFORM_OWNER"?409:403);
  });

  it.each(["lost","deactivated","blocked","replaced","inactive"])("denies preview of a %s Student card", async status => {
    state.snapshot={...studentCard(),cardStatus:status};
    expect((await fetch(`${baseUrl}/cards/41/preview?schoolId=9`)).status).toBe(409);
  });

  it("does not preview an inactive Student even when the assigned card is locked", async () => {
    state.snapshot={...studentCard(),studentStatus:"inactive",cardStatus:"locked"};
    expect((await fetch(`${baseUrl}/cards/41/preview?schoolId=9`)).status).toBe(409);
  });

  it("returns a clear empty assignment reason without selecting an arbitrary identity", async () => {
    state.snapshot={...studentCard(),studentId:null};
    const response=await fetch(`${baseUrl}/cards/41/preview?schoolId=9`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({error:"No active ID card is assigned to this person.",code:"CARD_NOT_ASSIGNED"});
  });

  it("masks an Owner's cross-school card preview without weakening the scoped lookup", async () => {
    state.snapshot=null;
    expect((await fetch(`${baseUrl}/cards/41/preview?schoolId=10`)).status).toBe(404);
    expect(state.values).toEqual([41,10]);
    expect(state.sql).toContain("nc.id=$1 AND nc.school_id=$2");
    expect(state.sql).toContain("st.school_id=nc.school_id");
  });

  it("previews with missing optional photo and school branding using the existing renderer placeholders", async () => {
    state.snapshot={...studentCard(),cardStatus:"locked",studentPhoto:null,schoolLogo:null,schoolRegistrationNumber:null};
    expect((await fetch(`${baseUrl}/cards/41/preview?schoolId=9`)).status).toBe(200);
  });

  it.each(["TEACHER","PARENT","STUDENT"])("denies %s official-card preview",async role=>{
    state.roles=[{role,schoolId:9,status:"ACTIVE"}];
    expect((await fetch(`${baseUrl}/cards/41/preview?schoolId=9`)).status).toBe(403);
  });

  it.each([
    { employeeStatus: "INACTIVE", employeeBindingStatus: "ACTIVE", cardStatus: "active" },
    { employeeStatus: "ACTIVE", employeeBindingStatus: "DEACTIVATED", cardStatus: "active" },
    { employeeStatus: "ACTIVE", employeeBindingStatus: "LOCKED", cardStatus: "locked" },
    { employeeStatus: "ACTIVE", employeeBindingStatus: "ACTIVE", cardStatus: "lost" },
  ])("fails closed for inactive or revoked Teacher assignments", async (lifecycle) => {
    state.snapshot = {
      ...studentCard(),
      studentId: null,
      studentStatus: null,
      employeeBindingCount: 1,
      employeeId: 202,
      employeeType: "TEACHER",
      employeeName: "Tunde Current",
      employeeNo: "EMP-202",
      ...lifecycle,
    };
    expect((await fetch(`${baseUrl}/cards/41/printable?schoolId=9`)).status).toBe(409);
  });

  it("supports safe missing-image fallback and repeated read-only downloads", async () => {
    const first = await fetch(`${baseUrl}/cards/41/printable?schoolId=9`);
    const firstPdf = Buffer.from(await first.arrayBuffer()).toString("latin1");
    const second = await fetch(`${baseUrl}/cards/41/printable?schoolId=9`);
    const secondPdf = Buffer.from(await second.arrayBuffer()).toString("latin1");
    expect(unicodeMapped(firstPdf, "PHOTO")).toBe(true);
    expect(second.status).toBe(200);
    expect(firstPdf).toBe(secondPdf);
    expect(state.reads).toBe(2);
    expect(mockPool.query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  });
});