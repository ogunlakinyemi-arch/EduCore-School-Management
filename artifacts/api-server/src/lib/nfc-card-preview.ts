import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
const run=promisify(execFile);
let rendering=0;

/** Raster-only viewing of the existing official PDF; never expose the printable PDF to school users. */
export async function rasterOfficialCard(pdf:Buffer) {
  if(rendering>=2) throw Error("Official card preview is busy; retry shortly");
  rendering++;
  let dir:string|undefined;
  try {
    dir=await mkdtemp(join(tmpdir(),"educore-card-preview-"));
    const source=join(dir,"source.pdf"),prefix=join(dir,"page");
    await writeFile(source,pdf,{mode:0o600});
    // MuPDF is already declared in the project's Nix dependencies.
    await run("mutool",["draw","-q","-F","png","-r","150","-o",prefix+"-%d.png",source,"1-2"],{timeout:15000,maxBuffer:1024*1024});
    const images=await Promise.all([readFile(prefix+"-1.png"),readFile(prefix+"-2.png")]);
    return {frontImage:`data:image/png;base64,${images[0].toString("base64")}`,
      backImage:`data:image/png;base64,${images[1].toString("base64")}`};
  } finally {
    if(dir) await rm(dir,{recursive:true,force:true});
    rendering--;
  }
}