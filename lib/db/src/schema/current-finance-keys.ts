/** PostgreSQL's source-DDL names, not Drizzle's default cross-table FK names. */
import { foreignKey, type AnyPgColumn } from "drizzle-orm/pg-core";
export const sourceName = (name: string) => name.slice(0, 63);
/** PostgreSQL makeObjectName/ChooseConstraintName rule for ASCII source names. */
export function sourceKeyName(table: string, columns: string[], label = "key") {
  const columnName = columns.join("_");
  let a = table.length, b = columnName.length;
  const available = 63 - label.length - (columnName ? 2 : 1);
  while (a + b > available) { if (a > b) a--; else b--; }
  return [table.slice(0, a), columnName.slice(0, b), label].filter(Boolean).join("_");
}
export function sourceReference(table: string, column: AnyPgColumn, parent: AnyPgColumn, restrict = false) {
  const key = foreignKey({
    name: sourceName(`${table}_${column.name}_fkey`),
    columns: [column], foreignColumns: [parent],
  });
  return restrict ? key.onDelete("restrict") : key;
}
