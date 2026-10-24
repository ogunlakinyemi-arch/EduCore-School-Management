import {beforeEach,afterAll,describe,it,expect,vi} from "vitest";
import {cardVerificationToken,readCardVerificationToken} from "./id-card-verification";
import {buildNfcPrintablePdf} from "./nfc-printable-pdf";
import {PDFDocument} from "pdf-lib";
import {printableCardPalette,studentCardPalette} from "./nfc-card-brand";
import {printableFrontText} from "./nfc-printable-test-utils";
const identity={cardId:12,schoolId:4,studentId:8,employeeId:null};
beforeEach(()=>vi.stubEnv("SESSION_SECRET","test-only-verification-secret-not-real"));
afterAll(()=>vi.unstubAllEnvs());
describe("opaque ID verification and official templates",()=>{
  it("round-trips stable identity without NFC UID or personal data",()=>{
    const token=cardVerificationToken(identity);
    expect(readCardVerificationToken(token)).toEqual(identity);
    expect(cardVerificationToken(identity)).toBe(token);
    expect(token).not.toContain("student");
    expect(token).not.toContain("school");
    expect(readCardVerificationToken(token.slice(0,-4)+"XXXX")).toBeNull();
    expect(readCardVerificationToken("AABBCCDD")).toBeNull();
    expect(readCardVerificationToken(cardVerificationToken({...identity,studentId:null,employeeId:3}))).toMatchObject({employeeId:3});
  });
  it("fails closed without a configured key and invalidates tokens after key rotation",()=>{
    const token=cardVerificationToken(identity);
    vi.stubEnv("SESSION_SECRET","different-test-only-verification-secret");
    expect(readCardVerificationToken(token)).toBeNull();
    vi.stubEnv("SESSION_SECRET","");
    expect(()=>cardVerificationToken(identity)).toThrow();
  });
  it("uses explicit school colors and separate CR80 student/staff fronts with QR graphics",async()=>{
    expect(await printableCardPalette(null,"#AA1122","#2255AA")).toEqual({primary:"0.667 0.067 0.133",secondary:"0.133 0.333 0.667"});
    const base={cardId:12,schoolName:"Test School",schoolRegistrationNumber:null,schoolAddress:"School Road",schoolCity:null,schoolState:null,
      schoolPhone:"123",schoolEmail:"school@example.test",personName:"Test Person",permanentNumber:"ID-123",
      schoolLogo:null,personPhoto:null,cardUid:"04ABCDEF123456",primaryColor:"#AA1122",secondaryColor:"#2255AA",verificationToken:cardVerificationToken(identity)};
    const student=await buildNfcPrintablePdf({...base,personType:"Student",className:"JSS 1"});
    const staff=await buildNfcPrintablePdf({...base,personType:"Staff",designation:"Library"});
    expect(student.equals(staff)).toBe(false);
    expect(student.toString("latin1")).toContain("0.667 0.067 0.133 rg");
    expect(staff.toString("latin1")).toContain("0.133 0.333 0.667 rg");
    expect(student.toString("latin1")).not.toContain("0.133 0.333 0.667 rg");
    for(const pdf of [student,staff]) {
      const rendered=pdf.toString("latin1");
      // Uploaded reference: school-first white header, photo left, details
      // central, QR right, and a contactless role footer at the bottom.
      expect(rendered).toMatch(/rg 0 0 [\d.]+ 31 re f/);
      expect(rendered).toContain("88.00 96.00 Td");
      expect(rendered).toContain(pdf===student?"88.00 49.00 Td":"88.00 58.00 Td");
      expect(rendered).toContain("83 8 m 87 12 87 20 83 24 c S");
      const doc=await PDFDocument.load(pdf);
      expect(doc.getPageCount()).toBe(2);
      for(const page of doc.getPages()) {expect(page.getWidth()).toBeCloseTo(85.6*72/25.4,3);expect(page.getHeight()).toBeCloseTo(53.98*72/25.4,3);}
      expect(pdf.toString("latin1").match(/re f/g)!.length).toBeGreaterThan(100);
    }
    const studentText=printableFrontText(student),staffText=printableFrontText(staff);
    expect(studentText).toContain("Test Person\nReg/Admission No.\nID-123\nUID No.\n04ABCDEF123456");
    expect(studentText).toContain("STUDENT ID");
    expect(studentText).not.toMatch(/JSS 1|Class|School Reg:|Library|^Student$/m);
    expect(staffText).toContain("Library");
    expect(staffText).not.toContain("04ABCDEF123456");
    const front=student.toString("latin1").split("\n6 0 obj")[0]!;
    const palette=await studentCardPalette(null,base.primaryColor);
    for(const color of Object.values(palette)) expect(front).toContain(`${color} rg`);
    expect(front).not.toContain("0.000 0.682 0.839 rg");
    await expect(buildNfcPrintablePdf({...base,personType:"Student",cardUid:null})).rejects.toThrow("assigned NFC UID");
    const changed=await buildNfcPrintablePdf({...base,personType:"Student",cardUid:"11223344556677889900",permanentNumber:"OTHER-ADM",personName:"Another Student",schoolName:"Another School"});
    expect(printableFrontText(changed)).toContain("11223344556677889900");
    expect(printableFrontText(changed)).toContain("OTHER-ADM");
    expect(printableFrontText(changed)).toContain("Another School");
    expect(printableFrontText(changed)).not.toContain("04ABCDEF123456");
  });
});
