import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";
import { developmentFilesystemGuard } from "../../scripts/vite-filesystem-guard.mjs";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

const developmentFiles = [
  path.resolve(import.meta.dirname, "index.html"),
  path.resolve(import.meta.dirname, "src"),
  path.resolve(import.meta.dirname, "public"),
  path.resolve(import.meta.dirname, "node_modules/.vite"),
  path.resolve(import.meta.dirname, "../../node_modules/.pnpm"),
];

export default defineConfig({
  base: basePath,
  plugins: [
    developmentFilesystemGuard(import.meta.dirname, developmentFiles, basePath),
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      allow: developmentFiles,
      deny: [
        ".env", ".env.*", "*.{crt,pem,key}", "**/.git/**",
        "**/.replit", "**/package.json", "**/tsconfig*.json",
        "**/*.config.*", "**/.agents/**", "**/.local/**", "**/reports/**",
      ],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
