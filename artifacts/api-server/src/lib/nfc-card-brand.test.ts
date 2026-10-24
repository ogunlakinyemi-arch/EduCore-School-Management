import {describe,expect,it} from "vitest";
import sharp from "sharp";
import {printableCardBrand,SAFE_CARD_BRAND,studentCardPalette} from "./nfc-card-brand";
import {buildNfcPrintablePdf} from "./nfc-printable-pdf";
import {printableFrontText} from "./nfc-printable-test-utils";
const logo=async(r:number,g:number,b:number)=>({
  bytes:await sharp({create:{width:50,height:25,channels:3,background:{r,g,b}}}).png().toBuffer(),width:50,height:25,
});
describe("official card logo branding",()=>{
  it("uses a deterministic safe default when missing or unusable",async()=>{
    expect(await printableCardBrand()).toBe(SAFE_CARD_BRAND);
    expect(await printableCardBrand({bytes:Buffer.from("corrupt"),width:1,height:1})).toBe(SAFE_CARD_BRAND);
    expect(await printableCardBrand(await logo(255,255,255))).toBe(SAFE_CARD_BRAND);
  });
  it("derives different dominant colours independently per school",async()=>{
    const red=(await printableCardBrand(await logo(180,20,30))).split(" ").map(Number);
    const blue=(await printableCardBrand(await logo(20,40,170))).split(" ").map(Number);
    expect(red[0]).toBeGreaterThan(red[2]!); expect(blue[2]).toBeGreaterThan(blue[0]!);
  });
  it("darkens light school colours while keeping the same hue family",async()=>{
    const yellow=(await printableCardBrand(await logo(250,225,15))).split(" ").map(Number);
    expect(yellow[0]).toBeGreaterThan(yellow[2]!);expect(yellow[1]).toBeGreaterThan(yellow[2]!);
    const linear=yellow.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    expect(linear[0]!*.2126+linear[1]!*.7152+linear[2]!*.0722).toBeLessThan(.185);
  });
});

async function crest(colors:number[][]) {
  const bytes=Buffer.alloc(60*40*3);
  for(let y=0;y<40;y++) for(let x=0;x<60;x++) {
    const color=colors[x<36?0:x<48?Math.min(1,colors.length-1):colors.length-1]!;
    for(let j=0;j<3;j++) bytes[(y*60+x)*3+j]=color[j]!;
  }
  return {bytes:await sharp(bytes,{raw:{width:60,height:40,channels:3}}).jpeg({quality:100}).toBuffer(),width:60,height:40};
}
const rgb=(color:string)=>color.split(" ").map(Number);
const contrast=(color:string)=>1.05/(.05+rgb(color).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
  .reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i]!,0));

describe("logo-derived Student card decoration",()=>{
  it("selects different dominant hues per school, ahead of configured fallback",async()=>{
    const red=await studentCardPalette(await crest([[170,20,35]]),"#004C91");
    const green=await studentCardPalette(await crest([[15,120,50]]),"#004C91");
    expect(rgb(red.primary)[0]).toBeGreaterThan(rgb(red.primary)[1]!);
    expect(rgb(green.primary)[1]).toBeGreaterThan(rgb(green.primary)[0]!);
    expect(red).not.toEqual(green);
  });
  it("keeps distinct secondary/accent hues present in the crest",async()=>{
    const p=await studentCardPalette(await crest([[150,20,30],[230,180,20],[10,125,80]]));
    // JPEG quantization can rank equally sized gold/green regions in either order.
    const accents=[rgb(p.secondary),rgb(p.tertiary)];
    expect(accents.some(c=>c[0]!>.7&&c[1]!>.5&&c[2]!<.2)).toBe(true);
    expect(accents.some(c=>c[1]!>c[0]!+.2&&c[1]!>c[2]!)).toBe(true);
  });
  it("darkens light brand colors to keep white text and icon above 4.5:1",async()=>{
    for(const color of [[255,240,0],[150,250,190],[245,245,245]]) {
      const p=await studentCardPalette(await crest([color]),"#FFFF00");
      expect(contrast(p.primary)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("uses tonal accents for single-color and monochrome crests",async()=>{
    for(const color of [[80,20,130],[0,0,0]]) {
      const p=await studentCardPalette(await crest([color]));
      expect(new Set(Object.values(p)).size).toBe(3);
      expect(contrast(p.primary)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("ignores blank/transparent backgrounds and falls back for unavailable logos",async()=>{
    const fallback=await studentCardPalette(null);
    const white=await crest([[255,255,255]]);
    const transparent={bytes:await sharp({create:{width:20,height:20,channels:4,background:{r:200,g:0,b:0,alpha:0}}}).png().toBuffer(),width:20,height:20};
    expect(await studentCardPalette(white)).toEqual(fallback);
    expect(await studentCardPalette(transparent)).toEqual(fallback);
    expect(await studentCardPalette({bytes:Buffer.from("invalid"),width:1,height:1})).toEqual(fallback);
    expect(contrast(fallback.primary)).toBeGreaterThanOrEqual(4.5);
    const configured=await studentCardPalette(null,"#A02030");
    expect(configured).not.toEqual(fallback);
    expect(contrast(configured.primary)).toBeGreaterThanOrEqual(4.5);
  });
  it("is deterministic and puts the logo palette and white icon into the actual PDF",async()=>{
    const image=await crest([[130,20,35],[220,180,20],[15,110,55]]);
    const p=await studentCardPalette(image);
    expect(await studentCardPalette(image)).toEqual(p);
    const pdf=await buildNfcPrintablePdf({cardId:17,schoolName:"Dynamic School",schoolRegistrationNumber:null,
      schoolAddress:null,schoolCity:null,schoolState:null,schoolPhone:null,schoolEmail:null,
      personType:"Student",personName:"Test Student",permanentNumber:"ADM-17",cardUid:"04AB1234567890",
      schoolLogo:image,primaryColor:"#0055BB",className:"MUST NOT PRINT"});
    const front=pdf.toString("latin1").split("\n6 0 obj")[0]!;
    for(const color of Object.values(p)) expect(front).toContain(`${color} rg`);
    expect(front).toContain("q 1 1 1 rg 72 11 7 9 re f 1 1 1 RG");
    expect(printableFrontText(pdf)).toContain("04AB1234567890");
    expect(printableFrontText(pdf)).not.toContain("MUST NOT PRINT");
  });
});