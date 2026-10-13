import type { Plugin } from "vite";
export function isAllowedDevelopmentFile(file: string, allowed: readonly string[]): boolean;
export function isPrivateDevelopmentPath(pathname: string): boolean;
export function developmentFilesystemGuard(root: string, allowed: readonly string[], base: string): Plugin;
