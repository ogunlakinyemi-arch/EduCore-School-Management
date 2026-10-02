import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { PrintableImage } from "./nfc-printable-images";

const PAGE_WIDTH = 85.6 * 72 / 25.4;
const PAGE_HEIGHT = 53.98 * 72 / 25.4;
const INK = "0.06 0.16 0.27";
const TEAL = "0.00 0.54 0.53";
const WHITE = "1 1 1";
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
  personType: "Student" | "Teacher";
  personName: string;
  permanentNumber: string;
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

function fittedText(value: string, x: number, y: number, size: number, color: string, font: EmbeddedFont, used: Map<number, { cid: number; codePoint: number; glyphId: number }>) {
  const clean = safeText(value, Number.MAX_SAFE_INTEGER);
  const width = Array.from(clean).reduce((sum, c) => sum + font.advance(font.cmap(c.codePointAt(0)!)), 0) * size / font.unitsPerEm;
  const fittedSize = Math.min(size, size * (PAGE_WIDTH - x - 12) / Math.max(1, width));
  return text(clean, x, y, fittedSize, color, font, used);
}

function frontContent(
  data: PrintableCardPdfData,
  images: ImageObject[],
  font: EmbeddedFont,
  used: Map<number, { cid: number; codePoint: number; glyphId: number }>,
) {
  const label = (value: string, x: number, y: number, size: number, color = INK) =>
    text(value, x, y, size, color, font, used);
  const commands = [
    `${TEAL} rg 0 ${PAGE_HEIGHT - 27} ${PAGE_WIDTH} 27 re f`,
    label("Yemait EduCore", 12, PAGE_HEIGHT - 17, 9, WHITE),
    label("NFC IDENTIFICATION", PAGE_WIDTH - 92, PAGE_HEIGHT - 17, 7, WHITE),
    `${INK} RG 0.7 w 8.5 8.5 ${PAGE_WIDTH - 17} ${PAGE_HEIGHT - 17} re S`,
  ];
  const logo = images.find((item) => item.name === "SchoolLogo");
  if (logo) commands.push(imageCommand(logo, 12, PAGE_HEIGHT - 115, 41, 20));
  const photo = images.find((item) => item.name === "PersonPhoto");
  if (photo) {
    commands.push(`${TEAL} RG 1 w 12 ${PAGE_HEIGHT - 91} 41 49 re S`);
    commands.push(imageCommand(photo, 13, PAGE_HEIGHT - 90, 39, 47));
  } else {
    commands.push(`${TEAL} RG 1 w 12 ${PAGE_HEIGHT - 91} 41 49 re S`);
    commands.push(label("PHOTO", 21, PAGE_HEIGHT - 60, 8, TEAL));
    commands.push(label("NOT", 26, PAGE_HEIGHT - 70, 8, TEAL));
    commands.push(label("AVAILABLE", 17, PAGE_HEIGHT - 80, 6, TEAL));
  }
  const detailX = 61;
  commands.push(fittedText(data.schoolName, 12, PAGE_HEIGHT - 37, 8, INK, font, used));
  commands.push(label(data.personType.toUpperCase(), detailX, PAGE_HEIGHT - 43, 7, TEAL));
  commands.push(fittedText(data.personName, detailX, PAGE_HEIGHT - 57, 9, INK, font, used));
  commands.push(fittedText(`${data.personType === "Student" ? "Admission No." : "Employee No."}: ${data.permanentNumber}`, detailX, PAGE_HEIGHT - 70, 6.5, INK, font, used));
  commands.push(label(`NFC-id-${data.cardId}`, detailX, PAGE_HEIGHT - 81, 6.5, TEAL));
  if (data.schoolRegistrationNumber) {
    commands.push(fittedText(`School Reg: ${data.schoolRegistrationNumber}`, detailX, PAGE_HEIGHT - 92, 5.8, INK, font, used));
  }
  commands.push(label("Permanent identity - school record remains current", 12, 13, 5.2));
  return commands.join("\n");
}

function backContent(
  data: PrintableCardPdfData,
  font: EmbeddedFont,
  used: Map<number, { cid: number; codePoint: number; glyphId: number }>,
) {
  const label = (value: string, x: number, y: number, size: number, color = INK) =>
    text(value, x, y, size, color, font, used);
  const address = [data.schoolAddress, data.schoolCity, data.schoolState].filter(Boolean).join(", ");
  const contact = [data.schoolPhone, data.schoolEmail].filter(Boolean).join(" | ");
  const commands = [
    `${TEAL} rg 0 ${PAGE_HEIGHT - 23} ${PAGE_WIDTH} 23 re f`,
    label("PROPERTY OF YEMAIT TECHNOLOGIES LIMITED", 12, PAGE_HEIGHT - 15, 8, WHITE),
    `${INK} RG 0.7 w 8.5 8.5 ${PAGE_WIDTH - 17} ${PAGE_HEIGHT - 17} re S`,
    label("Yemait EduCore NFC Identification Card", 12, PAGE_HEIGHT - 38, 8),
    label("This card remains the property of Yemait Technologies Limited and is", 12, PAGE_HEIGHT - 52, 6.2),
    label("issued for authorized identification and access purposes.", 12, PAGE_HEIGHT - 62, 6.2),
    label("If found, please return this card to the issuing school", 12, PAGE_HEIGHT - 77, 6.2),
    label("or the appropriate authority.", 12, PAGE_HEIGHT - 87, 6.2),
    fittedText(data.schoolName, 12, PAGE_HEIGHT - 104, 6.5, TEAL, font, used),
    ...(address ? [fittedText(address, 12, PAGE_HEIGHT - 114, 5.8, INK, font, used)] : []),
    ...(contact ? [fittedText(contact, 12, PAGE_HEIGHT - 123, 5.8, INK, font, used)] : []),
    label("Please do not tamper with or damage the NFC card.", 12, 16, 5.8),
    label("Copyright Yemait Technologies Limited | Yemait EduCore", 12, 9.5, 5.2),
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
  const front = frontContent(data, images, font, usedCharacters);
  const back = backContent(data, font, usedCharacters);
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
    schoolLogo: { bytes: logoBytes, width: 600, height: 260 },
    personPhoto: { bytes: photoBytes, width: 900, height: 1200 },
  });
}