/**
 * node scripts/build-offline-split-review.mjs
 * Produces a self-contained /tmp HTML fixture; starts no server and makes no
 * provider/database calls. The build never imports the app entry or auth.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const sharedPath = path.join(root, 'src/components/shared.tsx');
const source = await fs.readFile(sharedPath, 'utf8');
const ast = ts.createSourceFile(sharedPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
// Use the actual shared Button and currency formatter without importing the
// unrelated app/auth hooks from the large shared module.
const declarations = ast.statements.filter(statement => (
  ts.isFunctionDeclaration(statement) && ['Button', 'cx'].includes(statement.name?.text ?? '')
) || (
  ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => d.name.getText(ast) === 'money')
));
if (declarations.length !== 3) throw new Error('Actual shared Button/cx/money extraction changed; review the offline harness');
const sharedCode = `import type { ReactNode } from 'react';\n${declarations.map(d => d.getText(ast)).join('\n')}`;
const { transformWithEsbuild } = await import('vite');
const result = await build({
  root, configFile: false, envFile: false, publicDir: false, logLevel: 'warn',
  plugins: [{
    name: 'offline-review-only',
    enforce: 'pre',
    resolveId(id) { if (id === '@/components/shared') return '\0offline-review-shared'; },
    async load(id) {
      if (id === '\0offline-review-shared') {
        return (await transformWithEsbuild(sharedCode, 'offline-review-shared.tsx', { loader: 'tsx', jsx: 'automatic' })).code;
      }
    },
    transform(code, id) {
      // Prevent browser font requests. All app layout/color/touch styles remain.
      if (id.split('?')[0] === path.join(root, 'src/index.css')) return code.replace(/@import\s+url\([\s\S]*?\)\s*;/g, '');
    },
  }, react(), tailwindcss()],
  define: { 'process.env.NODE_ENV': '"development"', 'process.env.REPLIT_DEPLOYMENT': '""' },
  build: {
    write: false, emptyOutDir: false, minify: true,
    lib: { entry: path.join(root, 'src/test/offline-split-review.tsx'), formats: ['iife'], name: 'OfflineReviewAcceptance' },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output);
const javascript = outputs.filter(o => o.type === 'chunk').map(o => o.code).join('\n');
const css = outputs.filter(o => o.type === 'asset' && o.fileName.endsWith('.css')).map(o => o.source).join('\n');
if (!javascript || !css) throw new Error('Expected inline JavaScript and actual app CSS');
if (/@import\s*|url\(\s*["']?https?:/i.test(css)) throw new Error('Offline fixture must not contain external CSS imports or remote assets');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>TEST / NOT REAL — offline review acceptance</title><style>${css}</style></head><body><div id="root"></div><script>${javascript.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const out = '/tmp/educore-offline-split-review.html';
await fs.writeFile(out, html);
console.log(`Offline acceptance fixture: ${out} (${Buffer.byteLength(html)} bytes); no server started.`);
