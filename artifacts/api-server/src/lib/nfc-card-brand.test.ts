import {describe,expect,it} from "vitest";
import sharp from "sharp";
import {printableCardBrand,SAFE_CARD_BRAND} from "./nfc-card-brand";
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