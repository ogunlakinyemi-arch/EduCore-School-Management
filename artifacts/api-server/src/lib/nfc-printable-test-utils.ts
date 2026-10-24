/** Decode the actual front-page text, not merely the font's character inventory. */
export function printableFrontText(pdf: Buffer | string): string {
  const raw=typeof pdf==="string"?pdf:pdf.toString("latin1");
  const chars=new Map<string,string>();
  for(const group of raw.matchAll(/\d+ beginbfchar\n([\s\S]*?)endbfchar/g))
    for(const pair of group[1]!.matchAll(/<([0-9a-f]+)> <([0-9a-f]+)>/gi))
      chars.set(pair[1]!.toLowerCase(),Buffer.from(pair[2]!,"hex").swap16().toString("utf16le"));
  const front=/\n5 0 obj\n[\s\S]*?stream\n([\s\S]*?)\nendstream/.exec(raw)?.[1];
  if(!front) throw new Error("Official PDF front content stream missing");
  return [...front.matchAll(/<([0-9a-f]+)> Tj/gi)].map(match=>
    (match[1]!.match(/.{4}/g)??[]).map(cid=>chars.get(cid.toLowerCase())??"�").join("")
  ).join("\n");
}
