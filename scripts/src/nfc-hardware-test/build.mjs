import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Retain the real bundler's dependency/worker handling; never touch normal dist. */
export async function buildTerminalOnly(target, run) {
  const api = path.join(root, "artifacts/api-server");
  const cache = path.join(api, "node_modules/.cache/nfc-hardware-test", target);
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  let source = await fs.readFile(path.join(api, "build.mjs"), "utf8");
  const replacements = [
    ["const artifactDir = path.dirname(fileURLToPath(import.meta.url));", `const artifactDir = ${JSON.stringify(api)};`],
    ['path.resolve(artifactDir, "dist")', JSON.stringify(path.join(cache, "bundle"))],
    ['      path.resolve(artifactDir, "src/index.ts"),\n', ""],
  ];
  for (const [from, to] of replacements) {
    if (source.split(from).length !== 2) throw new Error("Bundler changed; refusing an unsafe output/entry substitution");
    source = source.replace(from, to);
  }
  const buildFile = path.join(cache, "build-isolated.mjs");
  await fs.writeFile(buildFile, source, { mode: 0o600 });
  await run(process.execPath, [buildFile]);
  return path.join(cache, "bundle/terminal-test-entry.mjs");
}
