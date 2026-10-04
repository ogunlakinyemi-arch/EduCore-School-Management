import {describe,expect,it} from "vitest";
import sharp from "sharp";
import {buildNfcPrintablePdfSample,buildNfcPrintablePdf} from "./nfc-printable-pdf";
import {rasterOfficialCard} from "./nfc-card-preview";
describe("real official-card raster renderer",()=>{
  it("renders the same front and back with landscape CR80 proportions",async()=>{
    const preview=await rasterOfficialCard(await buildNfcPrintablePdfSample());
    for(const image of [preview.frontImage,preview.backImage]) {
      const metadata=await sharp(Buffer.from(image.split(",")[1]!,"base64")).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.width!/metadata.height!).toBeCloseTo(85.6/53.98,2);
    }
  });
  it("renders long Unicode identity and missing images without breaking the PDF",async()=>{
    const pdf=await buildNfcPrintablePdf({cardId:908,personType:"Staff",
      schoolName:"QA Long School Name Academy for Science Technology and Community Development",
      schoolRegistrationNumber:"QA-SCHOOL-REGISTRATION-00000000000001",schoolAddress:"1 QA Road",
      schoolCity:"Lagos",schoolState:"Lagos",schoolPhone:null,schoolEmail:null,
      personName:"Ọlámidé Adéwọlé Chukwuebuka Mohammed-Alexander Elizabeth Johnson",
      permanentNumber:"QA-EMPLOYEE-000000000000000000000000000000000000001"});
    expect((await rasterOfficialCard(pdf)).frontImage).toMatch(/^data:image\/png;base64,/);
  });
});