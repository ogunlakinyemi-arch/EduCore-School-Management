import fs from "node:fs";
import path from "node:path";

// Vite's allow list is supplemented by canonical-path checks so a symlink
// below an allowed source/dependency directory cannot expose private siblings.
export function isAllowedDevelopmentFile(file, allowed) {
  const real = fs.realpathSync(file);
  return allowed.some(entry => {
    let root;
    try { root = fs.realpathSync(entry); } catch { return false; }
    return real === root || fs.statSync(root).isDirectory() && real.startsWith(root + path.sep);
  });
}
export function isPrivateDevelopmentPath(pathname) {
  const segments = pathname.split("/");
  return segments.some(segment => [".replit", ".agents", ".local", ".git", "package.json"].includes(segment) ||
      /^\.env(?:\.|$)/.test(segment) || /^vite\.config\./.test(segment) || /^tsconfig(?:\.[^.]+)?\.json$/.test(segment)) ||
    /^\/reports(?:\/|$)/.test(pathname);
}
export function developmentFilesystemGuard(root, allowed, base) {
  return {
    name: "private-workspace-filesystem-guard",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        try {
          let pathname = decodeURIComponent((req.url ?? "/").split("?")[0]);
          const prefix = base.replace(/\/$/, "");
          if (prefix && pathname.startsWith(prefix + "/")) pathname = pathname.slice(prefix.length);
          if (isPrivateDevelopmentPath(pathname)) {
            res.statusCode = 403; res.end("Private workspace file access denied"); return;
          }
          const file = pathname.startsWith("/@fs/")
            ? pathname.slice("/@fs".length)
            : path.resolve(root, "." + pathname);
          if (fs.existsSync(file) && fs.statSync(file).isFile() && !isAllowedDevelopmentFile(file, allowed)) {
            res.statusCode = 403; res.end("Private workspace file access denied"); return;
          }
          next();
        } catch {
          res.statusCode = 403; res.end("File access denied");
        }
      });
    },
  };
}
