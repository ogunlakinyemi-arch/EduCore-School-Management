import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { developmentFilesystemGuard } from '../../scripts/vite-filesystem-guard.mjs';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

const developmentFiles = [
  path.resolve(import.meta.dirname, 'index.html'),
  path.resolve(import.meta.dirname, 'src'),
  path.resolve(import.meta.dirname, 'public'),
  path.resolve(import.meta.dirname, 'node_modules/.vite'),
  path.resolve(import.meta.dirname, '../../node_modules/.pnpm'),
  path.resolve(import.meta.dirname, '../../lib/api-client-react'),
  path.resolve(import.meta.dirname, '../../lib/api-zod'),
];

export default defineConfig({
  base: basePath,
  plugins: [
    developmentFilesystemGuard(import.meta.dirname, developmentFiles, basePath),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
      // Do not use Vite's default workspace-root allowance: it exposes sibling
      // configuration, audit reports and uploaded documents through /@fs/.
      allow: developmentFiles,
      // Keep Vite's default secret protections when supplying an explicit deny.
      deny: [
        '.env', '.env.*', '*.{crt,pem,key}', '**/.git/**',
        '**/.replit', '**/package.json', '**/tsconfig*.json',
        '**/*.config.*', '**/.agents/**', '**/.local/**', '**/reports/**',
      ],
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
