import {describe,expect,it} from "vitest";
import sharp from "sharp";
import {buildNfcPrintablePdf, type PrintableCardPdfData} from "./nfc-printable-pdf";
import {employeeCardPalette,SAFE_CARD_BRAND} from "./nfc-card-brand";
import {printablePageText} from "./nfc-printable-test-utils";
import {rasterOfficialCard} from "./nfc-card-preview";

const base:PrintableCardPdfData={
  cardId:99,personType:"Driver",personName:"Example Employee",permanentNumber:"EMP-99",
  schoolName:"Fictional School",schoolRegistrationNumber:"SCHOOL-99",
  schoolAddress:"99 Example Road",schoolCity:"Example City",schoolState:null,
  schoolPhone:"08000000000",schoolEmail:"school@example.test",
  designation:"Transport Department",className:"CLASS MUST NEVER PRINT",
  verificationToken:"https://example.test/verify/opaque-token",
};
describe("official employee reference layout",()=>{
  it.each(["Teacher","Staff","Driver","Accountant"] as const)("prints %s identity and a white NFC role footer",async personType=>{
    const pdf=await buildNfcPrintablePdf({...base,personType});
    const front=printablePageText(pdf,1);
    expect(front).toContain(`${personType}\n`);
    expect(front).toContain(`${personType} ID`);
    for(const value of ["Fictional School","99 Example Road","school@example.test",
      "Example Employee","Transport Department","ID: EMP-99","VERIFY ID"]) expect(front).toContain(value);
    expect(front).not.toContain("CLASS MUST NEVER PRINT");
    expect(front).not.toContain("Student");
    expect(pdf.toString("latin1")).toContain("q 1 1 1 rg 72 11 7 9 re f 1 1 1 RG");
    expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 242.6457 153.0142]");
  });
  it("uses company/product/contact branding only on the reverse, independent of the school",async()=>{
    const first=await buildNfcPrintablePdf(base);
    const second=await buildNfcPrintablePdf({...base,schoolName:"Another School",
      primaryColor:"#AA0055",secondaryColor:"#FFCC00"});
    const back=printablePageText(first,2);
    expect(back).toBe(printablePageText(second,2));
    for(const text of ["PROPERTY OF YETENIA TECHNOLOGIES LIMITED","Yetenia Technologies Limited",
      "Yetenia EduCore NFC Identification Card","yetenia.com","School management","Attendance"]) expect(back).toContain(text);
    for(const text of ["Fictional School","99 Example Road","Example City","08000000000",
      "school@example.test","Transport Department","EMP-99"]) expect(back).not.toContain(text);
    expect(first.toString("latin1")).toContain(`${SAFE_CARD_BRAND} rg 0`);
  });
  it("embeds the employee palette, crest, portrait and QR in the real rasterized PDF",async()=>{
    const bytes=await sharp({create:{width:30,height:40,channels:3,background:"#A02030"}}).jpeg().toBuffer();
    const image={bytes,width:30,height:40};
    const palette=await employeeCardPalette(image);
    const pdf=await buildNfcPrintablePdf({...base,schoolLogo:image,personPhoto:image});
    const raw=pdf.toString("latin1");
    expect(raw).toContain("/SchoolLogo");
    expect(raw).toContain("/PersonPhoto");
    for(const color of Object.values(palette)) expect(raw).toContain(`${color} rg`);
    const preview=await rasterOfficialCard(pdf);
    for(const dataUrl of [preview.frontImage,preview.backImage]) {
      const metadata=await sharp(Buffer.from(dataUrl.split(",")[1]!,"base64")).metadata();
      expect(metadata.width!/metadata.height!).toBeCloseTo(85.6/53.98,2);
    }
  });
});
