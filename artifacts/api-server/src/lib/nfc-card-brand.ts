import sharp from "sharp";
import type { PrintableImage } from "./nfc-printable-images";

export const SAFE_CARD_BRAND = "0.00 0.54 0.53";

/** Select one dominant logo colour, never an average across unrelated hues. */
export async function printableCardBrand(logo?: PrintableImage | null): Promise<string> {
  if (!logo) return SAFE_CARD_BRAND;
  try {
    const {data,info}=await sharp(logo.bytes,{limitInputPixels:16_777_216})
      .resize(64,64,{fit:"inside",withoutEnlargement:true}).removeAlpha().toColourspace("srgb").raw().toBuffer({resolveWithObject:true});
    const bins=new Map<string,{n:number,r:number,g:number,b:number,chromatic:boolean}>();
    for(let i=0;i<data.length;i+=info.channels) {
      const r=data[i]!,g=data[i+1]!,b=data[i+2]!;
      if(Math.min(r,g,b)>225) continue; // the paper/background is not school branding
      const chromatic=Math.max(r,g,b)-Math.min(r,g,b)>=24;
      const key=[r,g,b].map(v=>Math.floor(v/24)).join(":");
      const bin=bins.get(key) ?? {n:0,r:0,g:0,b:0,chromatic};
      bin.n++; bin.r+=r; bin.g+=g; bin.b+=b; bins.set(key,bin);
    }
    const colours=[...bins.values()];
    const chromatic=colours.filter(x=>x.chromatic);
    const dominant=(chromatic.length ? chromatic : colours).sort((a,b)=>b.n-a.n)[0];
    if(!dominant) return SAFE_CARD_BRAND;
    let rgb=[dominant.r,dominant.g,dominant.b].map(v=>v/dominant.n/255);
    const luminance=(values:number[])=>values.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
      .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0);
    // Keep the selected hue, but darken light logos enough for the white header.
    while(luminance(rgb)>.18) rgb=rgb.map(v=>v*.92);
    return rgb.map(v=>v.toFixed(3)).join(" ");
  } catch { return SAFE_CARD_BRAND; }
}