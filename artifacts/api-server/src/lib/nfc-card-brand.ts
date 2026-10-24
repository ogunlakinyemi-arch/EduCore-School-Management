import sharp from "sharp";
import type { PrintableImage } from "./nfc-printable-images";

export const SAFE_CARD_BRAND = "0.00 0.54 0.53";
export function pdfBrandColor(value:unknown):string|null {
  if(typeof value!=="string" || !/^#[a-fA-F0-9]{6}$/.test(value)) return null;
  return [1,3,5].map(i=>(parseInt(value.slice(i,i+2),16)/255).toFixed(3)).join(" ");
}

const luminance = (rgb:number[]) => rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
  .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0);
const colorString = (rgb:number[]) => rgb.map(v=>v.toFixed(3)).join(" ");
const tintColor = (rgb:number[],amount:number) => rgb.map(v=>v+(1-v)*amount);
const distance = (a:number[],b:number[]) => a.reduce((sum,v,i)=>sum+(v-b[i]!)**2,0);

/** Logo-first Student palette. White paper/transparent pixels are not brand colours.
 * Keep actual secondary hues where present; otherwise use restrained tonal accents.
 * The band is darkened in the same hue to guarantee white text/icon contrast. */
export async function studentCardPalette(logo?:PrintableImage|null, fallbackPrimary?:string|null) {
  let colors:number[][]=[];
  if(logo) {
    try {
      const {data,info}=await sharp(logo.bytes,{limitInputPixels:16_777_216})
        .flatten({background:"#ffffff"}).toColourspace("srgb")
        .resize(64,64,{fit:"inside",withoutEnlargement:true,kernel:"nearest"})
        .raw().toBuffer({resolveWithObject:true});
      const bins=new Map<string,{n:number;sum:number[]}>();
      for(let i=0;i<data.length;i+=info.channels) {
        const rgb=[data[i]!,data[i+1]!,data[i+2]!];
        if(Math.min(...rgb)>225) continue;
        const key=rgb.map(v=>Math.floor(v/24)).join(":");
        const bin=bins.get(key)??{n:0,sum:[0,0,0]};
        bin.n++;bin.sum=bin.sum.map((v,j)=>v+rgb[j]!);bins.set(key,bin);
      }
      const ranked=[...bins.values()].sort((a,b)=>b.n-a.n).map(b=>b.sum.map(v=>v/b.n/255));
      const chromatic=ranked.filter(rgb=>Math.max(...rgb)-Math.min(...rgb)>.1);
      colors=chromatic.length?chromatic:ranked;
    } catch { /* Unavailable/invalid logos use the configured school fallback below. */ }
  }
  const original=colors[0]??(pdfBrandColor(fallbackPrimary)??SAFE_CARD_BRAND).split(" ").map(Number);
  let band=[...original];
  // A little headroom preserves >=4.5:1 even after PDF decimal rounding.
  while(luminance(band)>.17) band=band.map(v=>v*.92);
  const secondary=colors.slice(1).find(rgb=>distance(rgb,original)>.12)??tintColor(band,.32);
  const tertiary=colors.slice(1).find(rgb=>distance(rgb,original)>.12&&distance(rgb,secondary)>.12)
    ??tintColor(secondary,.4);
  return {primary:colorString(band),secondary:colorString(secondary),tertiary:colorString(tertiary)};
}
export async function printableCardPalette(logo?:PrintableImage|null, primary?:string|null, secondary?:string|null) {
  const p=pdfBrandColor(primary) ?? await printableCardBrand(logo);
  let s=pdfBrandColor(secondary);
  if(!s && logo) {
    try {
      const {data,info}=await sharp(logo.bytes).resize(40,40,{fit:"inside"}).removeAlpha().raw().toBuffer({resolveWithObject:true});
      const bins=new Map<string,number>(), base=p.split(" ").map(Number);
      for(let i=0;i<data.length;i+=info.channels) {
        const rgb=[data[i]!,data[i+1]!,data[i+2]!].map(v=>Math.round(v/32)*32/255);
        if(Math.min(...rgb)>.88 || Math.max(...rgb)-Math.min(...rgb)<.15 ||
          rgb.reduce((sum,v,j)=>sum+(v-base[j]!)**2,0)<.15) continue;
        const key=rgb.map(v=>Math.min(1,v).toFixed(3)).join(" ");
        bins.set(key,(bins.get(key)??0)+1);
      }
      s=[...bins].sort((a,b)=>b[1]-a[1])[0]?.[0]??null;
    } catch { /* Explicit configurable colors remain authoritative. */ }
  }
  return {primary:p,secondary:s??"0.06 0.16 0.27"};
}

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