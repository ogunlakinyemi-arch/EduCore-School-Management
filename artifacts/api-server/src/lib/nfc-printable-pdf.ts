import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { PrintableImage } from "./nfc-printable-images";
import { employeeCardPalette, SAFE_CARD_BRAND, studentCardPalette } from "./nfc-card-brand";
import type { EmployeeCardRole } from "./nfc-card-roles";
import QRCode from "qrcode";

const PAGE_WIDTH = 85.6 * 72 / 25.4;
const PAGE_HEIGHT = 53.98 * 72 / 25.4;
const INK = "0.06 0.16 0.27";
const WHITE = "1 1 1";
const headerInk = (color:string) => color.split(" ").reduce((s,v,i)=>s+Number(v)*[.2126,.7152,.0722][i]!,0)>.55?INK:WHITE;
const FONT_URL = new URL("../assets/fonts/DejaVuSans.ttf", import.meta.url);

type FontTable = { offset: number; length: number };
type EmbeddedFont = {
  bytes: Buffer;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  cmap: (codePoint: number) => number;
  advance: (glyphId: number) => number;
};

let embeddedFontPromise: Promise<EmbeddedFont> | undefined;

function parseFont(bytes: Buffer): EmbeddedFont {
  const tableCount = bytes.readUInt16BE(4);
  const tables = new Map<string, FontTable>();
  for (let index = 0; index < tableCount; index += 1) {
    const entry = 12 + index * 16;
    tables.set(bytes.toString("ascii", entry, entry + 4), {
      offset: bytes.readUInt32BE(entry + 8),
      length: bytes.readUInt32BE(entry + 12),
    });
  }
  const required = (name: string) => {
    const table = tables.get(name);
    if (!table) throw new Error(`Bundled Unicode font is missing the ${name} table`);
    return table.offset;
  };
  const head = required("head");
  const hhea = required("hhea");
  const maxp = required("maxp");
  const hmtx = required("hmtx");
  const unitsPerEm = bytes.readUInt16BE(head + 18);
  const ascent = bytes.readInt16BE(hhea + 4);
  const descent = bytes.readInt16BE(hhea + 6);
  const metricCount = bytes.readUInt16BE(hhea + 34);
  const glyphCount = bytes.readUInt16BE(maxp + 4);
  const cmapTable = tables.get("cmap");
  if (!cmapTable || !unitsPerEm || !metricCount || !glyphCount) {
    throw new Error("Bundled Unicode font tables are invalid");
  }
  const cmapOffset = cmapTable.offset;
  const cmapEntries = bytes.readUInt16BE(cmapOffset + 2);
  let format12Offset: number | undefined;
  let format4Offset: number | undefined;
  for (let index = 0; index < cmapEntries; index += 1) {
    const entry = cmapOffset + 4 + index * 8;
    const platform = bytes.readUInt16BE(entry);
    const encoding = bytes.readUInt16BE(entry + 2);
    const offset = cmapOffset + bytes.readUInt32BE(entry + 4);
    const format = bytes.readUInt16BE(offset);
    if (format === 12 && (platform === 0 || (platform === 3 && encoding === 10))) {
      format12Offset = offset;
      if (platform === 3 && encoding === 10) break;
    }
    if (format === 4 && !format4Offset && (platform === 0 || platform === 3)) format4Offset = offset;
  }
  if (!format12Offset && !format4Offset) throw new Error("Bundled Unicode font has no supported cmap");
  const glyph = (codePoint: number): number => {
    if (format12Offset && codePoint <= 0x10ffff) {
      const groups = bytes.readUInt32BE(format12Offset + 12);
      let low = 0;
      let high = groups - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1;
        const group = format12Offset + 16 + middle * 12;
        const start = bytes.readUInt32BE(group);
        const end = bytes.readUInt32BE(group + 4);
        if (codePoint < start) high = middle - 1;
        else if (codePoint > end) low = middle + 1;
        else return bytes.readUInt32BE(group + 8) + codePoint - start;
      }
    }
    if (format4Offset && codePoint <= 0xffff) {
      const segmentCount = bytes.readUInt16BE(format4Offset + 6) / 2;
      const endStart = format4Offset + 14;
      const startStart = endStart + segmentCount * 2 + 2;
      const deltaStart = startStart + segmentCount * 2;
      const rangeStart = deltaStart + segmentCount * 2;
      for (let segment = 0; segment < segmentCount; segment += 1) {
        const end = bytes.readUInt16BE(endStart + segment * 2);
        const start = bytes.readUInt16BE(startStart + segment * 2);
        if (codePoint < start || codePoint > end) continue;
        const delta = bytes.readInt16BE(deltaStart + segment * 2);
        const rangeOffsetPosition = rangeStart + segment * 2;
        const rangeOffset = bytes.readUInt16BE(rangeOffsetPosition);
        if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
        const glyphPosition = rangeOffsetPosition + rangeOffset + (codePoint - start) * 2;
        const glyphId = bytes.readUInt16BE(glyphPosition);
        return glyphId === 0 ? 0 : (glyphId + delta) & 0xffff;
      }
    }
    return 0;
  };
  const advance = (glyphId: number) => {
    const metric = Math.min(Math.max(glyphId, 0), metricCount - 1);
    return bytes.readUInt16BE(hmtx + metric * 4);
  };
  return { bytes, unitsPerEm, ascent, descent, cmap: glyph, advance };
}

async function loadEmbeddedFont(): Promise<EmbeddedFont> {
  if (!embeddedFontPromise) {
    embeddedFontPromise = (async () => {
      const modulePath = fileURLToPath(import.meta.url);
      const moduleDirectory = path.dirname(modulePath);
      const candidates = [
        FONT_URL,
        new URL("../src/assets/fonts/DejaVuSans.ttf", import.meta.url),
        new URL("../../src/assets/fonts/DejaVuSans.ttf", import.meta.url),
      ];
      let lastError: unknown;
      for (const candidate of candidates) {
        try {
          return parseFont(await readFile(candidate));
        } catch (error) {
          lastError = error;
        }
      }
      // Retain a useful absolute location in the error message without ever
      // searching system font paths or making a network request.
      throw new Error(`Unable to load the bundled NFC Unicode font from ${moduleDirectory}: ${String(lastError)}`);
    })();
  }
  return embeddedFontPromise;
}

export type PrintableCardPdfData = {
  cardId: number;
  schoolName: string;
  schoolRegistrationNumber: string | null;
  schoolAddress: string | null;
  schoolCity: string | null;
  schoolState: string | null;
  schoolPhone: string | null;
  schoolEmail: string | null;
  personType: "Student" | EmployeeCardRole;
  personName: string;
  permanentNumber: string;
  cardUid?:string|null;
  className?:string|null;
  designation?:string|null;
  primaryColor?:string|null;
  secondaryColor?:string|null;
  verificationToken?:string;
  schoolLogo?: PrintableImage | null;
  personPhoto?: PrintableImage | null;
};

function safeText(value: string, maxLength = 64) {
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, maxLength)
    .join("");
}

function utf16beHex(value: string) {
  const littleEndian = Buffer.from(value, "utf16le");
  for (let index = 0; index < littleEndian.length; index += 2) {
    const byte = littleEndian[index]!;
    littleEndian[index] = littleEndian[index + 1]!;
    littleEndian[index + 1] = byte;
  }
  return littleEndian.toString("hex").toUpperCase();
}

type ImageObject = { name: string; image: PrintableImage; objectId: number };

function imageCommand(image: ImageObject, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.image.width, height / image.image.height);
  const w = image.image.width * scale;
  const h = image.image.height * scale;
  return `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${(x + (width - w) / 2).toFixed(2)} ${(y + (height - h) / 2).toFixed(2)} cm /${image.name} Do Q`;
}

function encodeText(value: string, font: EmbeddedFont, used: Map<number, { cid: number; codePoint: number; glyphId: number }>) {
  const output: string[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    let entry = used.get(codePoint);
    if (!entry) {
      entry = { cid: used.size + 1, codePoint, glyphId: font.cmap(codePoint) };
      used.set(codePoint, entry);
    }
    output.push(entry.cid.toString(16).padStart(4, "0"));
  }
  return `<${output.join("").toUpperCase()}>`;
}

function text(
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  font: EmbeddedFont,
  used: Map<number, { cid: number; codePoint: number; glyphId: number }>,
) {
  return `BT /F1 ${size} Tf ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} Td ${encodeText(value, font, used)} Tj ET`;
}

function fittedText(value: string, x: number, y: number, size: number, color: string, font: EmbeddedFont, used: Map<number, { cid: number; codePoint: number; glyphId: number }>, maxWidth = PAGE_WIDTH-x-12) {
  const clean = safeText(value, Number.MAX_SAFE_INTEGER);
  const width = Array.from(clean).reduce((sum, c) => sum + font.advance(font.cmap(c.codePointAt(0)!)), 0) * size / font.unitsPerEm;
  const fittedSize = Math.min(size, size * maxWidth / Math.max(1, width));
  return text(clean, x, y, fittedSize, color, font, used);
}

function frontContent(
  data: PrintableCardPdfData,
  images: ImageObject[],
  font: EmbeddedFont,
  used: Map<number, { cid: number; codePoint: number; glyphId: number }>,
  schoolPrimary: string,
  SECONDARY: string,
  tertiary?:string,
) {
  const student=data.personType==="Student";
  const TEAL=schoolPrimary;
  if(student && !data.cardUid?.trim()) throw new Error("Student card printing requires its assigned NFC UID");
  const label = (value: string, x: number, y: number, size: number, color = INK) =>
    text(value, x, y, size, color, font, used);
  const bold = (value:string,x:number,y:number,size:number,width:number,color=INK) =>
    `q ${color} RG 0.15 w ${fittedText(value,x,y,size,color,font,used,width).replace(" Tf "," Tf 2 Tr ")} Q`;
  const tint = (amount:number) => TEAL.split(" ").map(v=>(Number(v)+(1-Number(v))*amount).toFixed(3)).join(" ");
  const accent = SECONDARY;
  const rounded = (x:number,y:number,w:number,h:number,r:number) => {
    const k=r*.55228475;
    return `${x+r} ${y} m ${x+w-r} ${y} l ${x+w-r+k} ${y} ${x+w} ${y+r-k} ${x+w} ${y+r} c
      ${x+w} ${y+h-r} l ${x+w} ${y+h-r+k} ${x+w-r+k} ${y+h} ${x+w-r} ${y+h} c
      ${x+r} ${y+h} l ${x+r-k} ${y+h} ${x} ${y+h-r+k} ${x} ${y+h-r} c
      ${x} ${y+r} l ${x} ${y+r-k} ${x+r-k} ${y} ${x+r} ${y} c h`;
  };
  // Match the supplied school-first reference, without copying its child's photo,
  // school identity or QR. All identity/images still come from the scoped snapshot.
  const commands = [
    "q",
    `${rounded(1,1,PAGE_WIDTH-2,PAGE_HEIGHT-2,8)} W n`,
    `${WHITE} rg 0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} re f`,
    bold(data.schoolName,52,PAGE_HEIGHT-17,8.8,PAGE_WIDTH-63),
  ];
  const address=[data.schoolAddress,data.schoolCity,data.schoolState].filter(Boolean).join(", ");
  const contact=[data.schoolPhone,data.schoolEmail].filter(Boolean).join("  |  ");
  if(address) commands.push(fittedText(address,52,PAGE_HEIGHT-27,6.2,INK,font,used,PAGE_WIDTH-63));
  if(contact) commands.push(fittedText(contact,52,PAGE_HEIGHT-36,6,INK,font,used,PAGE_WIDTH-63));
  const logo = images.find((item) => item.name === "SchoolLogo");
  if (logo) commands.push(imageCommand(logo,14,PAGE_HEIGHT-42,29,31));

  // Both fronts use logo-derived palettes, with a separate employee band hue.
  commands.push(`${tint(.7)} rg 0 32 m 42 0 l 0 0 l h f`);
  commands.push(`${accent} rg ${PAGE_WIDTH-53} 29 m ${PAGE_WIDTH} 52 l ${PAGE_WIDTH} 29 l h f`);
   commands.push(`${tertiary??tint(.58)} rg ${PAGE_WIDTH-36} 29 m ${PAGE_WIDTH} 43 l ${PAGE_WIDTH} 29 l h f`);
  commands.push(`${TEAL} rg 0 0 ${PAGE_WIDTH} 31 re f`);
  commands.push(`${accent} rg 0 36 m 48 0 l 39 0 l 0 29 l h f`);
  commands.push(`${student?accent:tint(.58)} rg 0 26 m 34 0 l 28 0 l 0 20 l h f`);
  if(data.personType!=="Student")
    commands.push(`${SECONDARY} rg ${PAGE_WIDTH-30} 31 m ${PAGE_WIDTH} 45 l ${PAGE_WIDTH} 0 l ${PAGE_WIDTH-8} 0 l h f`);

  const photo = images.find((item) => item.name === "PersonPhoto");
  commands.push(`${tint(.94)} rg ${rounded(12,39,66,72,5)} f`);
  if (photo) {
    commands.push(`q ${rounded(12,39,66,72,5)} W n`,imageCommand(photo,12,39,66,72),"Q");
  } else {
    commands.push(label("PHOTO",30,83,7),label("NOT",36,73,7),label("AVAILABLE",23,63,6.5));
  }
  const detailX = 88;
  commands.push(bold(data.personName,detailX,96,9.2,103));
  if(student) {
    commands.push(label("Reg/Admission No.",detailX,83,5.8));
    commands.push(fittedText(data.permanentNumber,detailX,73,7.4,INK,font,used,103));
    commands.push(label("UID No.",detailX,59,5.8));
    commands.push(fittedText(data.cardUid!.trim(),detailX,49,6.8,INK,font,used,103));
  } else {
    commands.push(label(data.personType,detailX,83,7.4));
    if(data.designation) commands.push(fittedText(data.designation,detailX,71,7,INK,font,used,103));
    commands.push(fittedText(`ID: ${data.permanentNumber}`,detailX,58,6.7,INK,font,used,103));
    if(data.schoolRegistrationNumber)
      commands.push(fittedText(`School Reg: ${data.schoolRegistrationNumber}`,detailX,41,4.8,INK,font,used,PAGE_WIDTH-detailX-12));
  }
  if(data.verificationToken) {
    const qr=QRCode.create(data.verificationToken,{errorCorrectionLevel:"M"}).modules;
    const size=42, unit=size/(qr.size+8), x=PAGE_WIDTH-49,y=63;
    commands.push(`${WHITE} rg ${x} ${y} ${size} ${size} re f`,"0 0 0 rg");
    for(let row=0;row<qr.size;row++) for(let col=0;col<qr.size;col++) if(qr.get(row,col))
      commands.push(`${(x+(col+4)*unit).toFixed(4)} ${(y+(qr.size-row+3)*unit).toFixed(4)} ${unit.toFixed(4)} ${unit.toFixed(4)} re f`);
    commands.push(label("VERIFY ID",x+5,y-5,4.8));
  }
  const footerInk=WHITE;
  commands.push(`q ${footerInk} rg 72 11 7 9 re f ${footerInk} RG 1.9 w 1 J`);
  commands.push("83 8 m 87 12 87 20 83 24 c S");
  commands.push("89 5 m 95 11 95 21 89 27 c S");
  commands.push("95 2 m 103 10 103 22 95 30 c S Q");
  commands.push(bold(`${student?"STUDENT":data.personType} ID`,115,11,10.5,100,footerInk));
  commands.push("Q",`0.85 0.9 0.93 RG 0.7 w ${rounded(1,1,PAGE_WIDTH-2,PAGE_HEIGHT-2,8)} S`);
  return commands.join("\n");
}

function backContent(
  data: PrintableCardPdfData,
  font: EmbeddedFont,
  used: Map<number, { cid: number; codePoint: number; glyphId: number }>,
  TEAL: string,
) {
  const label = (value: string, x: number, y: number, size: number, color = INK) =>
    text(value, x, y, size, color, font, used);
  const commands = [
    `${TEAL} rg 0 ${PAGE_HEIGHT - 23} ${PAGE_WIDTH} 23 re f`,
    label("PROPERTY OF YETENIA TECHNOLOGIES LIMITED", 12, PAGE_HEIGHT - 15, 8, headerInk(TEAL)),
    `${INK} RG 0.7 w 8.5 8.5 ${PAGE_WIDTH - 17} ${PAGE_HEIGHT - 17} re S`,
    label("Yetenia EduCore NFC Identification Card", 12, PAGE_HEIGHT - 38, 8),
    fittedText("This card is the property of YETENIA TECHNOLOGIES LIMITED.", 12, PAGE_HEIGHT - 52, 6.2,INK,font,used),
    label("Use only for authorized identification and access purposes.", 12, PAGE_HEIGHT - 62, 6.2),
    label("If found, please return this card to the issuing school", 12, PAGE_HEIGHT - 77, 6.2),
    label("or the appropriate authority.", 12, PAGE_HEIGHT - 87, 6.2),
    label("Yetenia Technologies Limited | yetenia.com", 12, PAGE_HEIGHT - 104, 7),
    label("EduCore | School management and NFC identification", 12, PAGE_HEIGHT - 115, 6.2),
    label("Attendance, school entry and family notifications", 12, PAGE_HEIGHT - 125, 6),
    label("Please do not tamper with or damage the NFC card.", 12, 16, 5.8),
    label("Copyright YETENIA TECHNOLOGIES LIMITED | Yetenia EduCore", 12, 9.5, 5.2),
  ];
  return commands.join("\n");
}

function binaryImageObject(image: PrintableImage) {
  return Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      "ascii",
    ),
    image.bytes,
    Buffer.from("\nendstream", "ascii"),
  ]);
}

/** Two vector-print pages at exact landscape CR80 dimensions; no PDF metadata. */
export async function buildNfcPrintablePdf(data: PrintableCardPdfData): Promise<Buffer> {
  const font = await loadEmbeddedFont();
  const usedCharacters = new Map<number, { cid: number; codePoint: number; glyphId: number }>();
  const images: ImageObject[] = [];
  if (data.schoolLogo) images.push({ name: "SchoolLogo", image: data.schoolLogo, objectId: 0 });
  if (data.personPhoto) images.push({ name: "PersonPhoto", image: data.personPhoto, objectId: 0 });
  images.forEach((image, index) => { image.objectId = 7 + index; });

  const frontResources = images.length
    ? ` /XObject << ${images.map((image) => `/${image.name} ${image.objectId} 0 R`).join(" ")} >>`
    : "";
  const frontBrand=await (data.personType==="Student"?studentCardPalette:employeeCardPalette)(
    data.schoolLogo,data.primaryColor);
  const front = frontContent(data, images, font, usedCharacters,
    frontBrand.primary,frontBrand.secondary,frontBrand.tertiary);
  const back = backContent(data, font, usedCharacters, SAFE_CARD_BRAND);
  const backContentId = 7 + images.length;
  const fontFileId = backContentId + 1;
  const fontDescriptorId = fontFileId + 1;
  const cidFontId = fontDescriptorId + 1;
  const toUnicodeId = cidFontId + 1;
  const cidMapId = toUnicodeId + 1;
  const encodedCharacters = [...usedCharacters.values()];
  const widthArray = encodedCharacters.map((entry) =>
    `${entry.cid} [${Math.round(font.advance(entry.glyphId) * 1000 / font.unitsPerEm)}]`
  ).join(" ");
  const unicodeEntries = encodedCharacters.map((entry) =>
    `<${entry.cid.toString(16).padStart(4, "0")}> <${utf16beHex(String.fromCodePoint(entry.codePoint))}>`
  );
  const cmapGroups: string[] = [];
  for (let index = 0; index < unicodeEntries.length; index += 100) {
    const chunk = unicodeEntries.slice(index, index + 100);
    cmapGroups.push(`${chunk.length} beginbfchar\n${chunk.join("\n")}\nendbfchar`);
  }
  const toUnicode = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${cmapGroups.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const cidMap = Buffer.alloc((encodedCharacters.length + 1) * 2);
  for (const entry of encodedCharacters) cidMap.writeUInt16BE(entry.glyphId, entry.cid * 2);
  const scaledAscent = Math.round(font.ascent * 1000 / font.unitsPerEm);
  const scaledDescent = Math.round(font.descent * 1000 / font.unitsPerEm);
  const objects: Array<string | Buffer> = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>",
    `<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(4)} ${PAGE_HEIGHT.toFixed(4)}] /Resources << /Font << /F1 3 0 R /F2 3 0 R >>${frontResources} >> /Contents 5 0 R >>`,
    `<< /Length ${Buffer.byteLength(front, "ascii")} >>\nstream\n${front}\nendstream`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(4)} ${PAGE_HEIGHT.toFixed(4)}] /Resources << /Font << /F1 3 0 R /F2 3 0 R >> >> /Contents ${backContentId} 0 R >>`,
    ...images.map((image) => binaryImageObject(image.image)),
    `<< /Length ${Buffer.byteLength(back, "ascii")} >>\nstream\n${back}\nendstream`,
    Buffer.concat([
      Buffer.from(`<< /Length ${font.bytes.length} /Length1 ${font.bytes.length} >>\nstream\n`, "ascii"),
      font.bytes,
      Buffer.from("\nendstream", "ascii"),
    ]),
    `<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 /FontBBox [-1021 -463 1793 1232] /ItalicAngle 0 /Ascent ${scaledAscent} /Descent ${scaledDescent} /CapHeight ${scaledAscent} /StemV 80 /FontFile2 ${fontFileId} 0 R >>`,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fontDescriptorId} 0 R /DW 600 /W [${widthArray}] /CIDToGIDMap ${cidMapId} 0 R >>`,
    `<< /Length ${Buffer.byteLength(toUnicode, "ascii")} >>\nstream\n${toUnicode}\nendstream`,
    Buffer.concat([
      Buffer.from(`<< /Length ${cidMap.length} >>\nstream\n`, "ascii"),
      cidMap,
      Buffer.from("\nendstream", "ascii"),
    ]),
  ];

  const document: Buffer[] = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets: number[] = [0];
  let length = document[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const parts = [
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      typeof object === "string" ? Buffer.from(object, "ascii") : object,
      Buffer.from("\nendobj\n", "ascii"),
    ];
    document.push(...parts);
    length += parts.reduce((sum, part) => sum + part.length, 0);
  });
  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  document.push(Buffer.from(xref, "ascii"));
  return Buffer.concat(document);
}

export const nfcPrintablePageSizePoints = { width: PAGE_WIDTH, height: PAGE_HEIGHT };

/** A local, deterministic sample that exercises the real logo/photo PDF path. */
export async function buildNfcPrintablePdfSample(): Promise<Buffer> {
  const [logoBytes, photoBytes] = await Promise.all([
    sharp({ create: { width: 600, height: 260, channels: 3, background: { r: 0, g: 132, b: 126 } } })
      .jpeg({ quality: 90 }).toBuffer(),
    sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 210, g: 180, b: 150 } } })
      .jpeg({ quality: 90 }).toBuffer(),
  ]);
  return buildNfcPrintablePdf({
    cardId: 907,
    schoolName: "Yemait Sample School",
    schoolRegistrationNumber: "SAMPLE-REG",
    schoolAddress: "1 Sample Road",
    schoolCity: "Lagos",
    schoolState: "Lagos",
    schoolPhone: "08000000000",
    schoolEmail: "sample@example.test",
    personType: "Student",
    personName: "Ọlámidé Ọ̀jọ́",
    permanentNumber: "PERMANENT-907",
    cardUid: "04A1B2C3D4E5F6",
    schoolLogo: { bytes: logoBytes, width: 600, height: 260 },
    personPhoto: { bytes: photoBytes, width: 900, height: 1200 },
  });
}