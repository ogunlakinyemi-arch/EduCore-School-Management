import { writeFile } from "node:fs/promises";

await writeFile(
  new URL("../api-zod/src/index.ts", import.meta.url),
  'export * from "./generated/api";\n',
);