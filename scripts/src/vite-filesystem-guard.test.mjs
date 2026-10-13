import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isAllowedDevelopmentFile, isPrivateDevelopmentPath } from "../vite-filesystem-guard.mjs";
test("private metadata URLs fail closed instead of falling through to SPA HTML", () => {
  for (const url of ["/.replit", "/.env", "/.env.local", "/.agents/memory/a.md", "/package.json", "/vite.config.ts", "/reports/a.html"])
    assert.equal(isPrivateDevelopmentPath(url), true);
  for (const url of ["/src/main.tsx", "/@vite/client", "/node_modules/.vite/deps/react.js", "/src/pages/reports/index.tsx"])
    assert.equal(isPrivateDevelopmentPath(url), false);
});
test("allows approved source files but rejects private siblings and symlink escapes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vite-file-guard-"));
  try {
    const src = path.join(root, "src"); fs.mkdirSync(src);
    const privateFile = path.join(root, ".replit"); fs.writeFileSync(privateFile, "synthetic private config");
    const source = path.join(src, "main.ts"); fs.writeFileSync(source, "export {}");
    fs.symlinkSync(privateFile, path.join(src, "alias.txt"));
    assert.equal(isAllowedDevelopmentFile(source, [src]), true);
    assert.equal(isAllowedDevelopmentFile(privateFile, [src]), false);
    assert.equal(isAllowedDevelopmentFile(path.join(src, "alias.txt"), [src]), false);
    assert.equal(isAllowedDevelopmentFile(privateFile, [source]), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
