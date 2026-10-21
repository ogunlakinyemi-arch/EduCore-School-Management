import { writeFile } from "node:fs/promises";

await writeFile(
  new URL("../api-zod/src/index.ts", import.meta.url),
  'export * from "./generated/api";\n'
  + 'export type {OwnerAttendanceReport} from "./generated/types/ownerAttendanceReport";\n'
  + 'export type {OwnerAttendanceRow} from "./generated/types/ownerAttendanceRow";\n'
  + 'export type {OwnerAttendanceEvidence} from "./generated/types/ownerAttendanceEvidence";\n',
);