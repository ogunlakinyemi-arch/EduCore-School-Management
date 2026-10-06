import { createRequire } from "node:module";
import path from "node:path";

export async function inspectModel(workspaceRoot) {
  // Import only the schema barrel, never @workspace/db's client entry point.
  const require = createRequire(path.join(workspaceRoot, "lib/db/package.json"));
  const { is, Table } = require("drizzle-orm");
  const { getTableConfig, PgDialect } = require("drizzle-orm/pg-core");
  const schema = await import(path.join(workspaceRoot, "lib/db/src/schema/index.ts"));
  const dialect = new PgDialect();
  const tables = [...new Set(Object.values(schema).filter(value => is(value, Table)))];
  return {
    tables: tables.map(table => {
      const c = getTableConfig(table), namespace = c.schema || "public";
      const id = namespace + "." + c.name;
      const keys = [], indexes = [];
      const primary = c.columns.filter(column => column.primary);
      if (primary.length) keys.push({ name: c.name + "_pkey", kind: "primary", columns: primary.map(c => c.name) });
      for (const pk of c.primaryKeys) keys.push({ name: pk.getName(), kind: "primary", columns: pk.columns.map(c => c.name) });
      for (const column of c.columns) if (column.isUnique) {
        keys.push({ name: column.uniqueName, kind: "unique_constraint", columns: [column.name] });
      }
      for (const key of c.uniqueConstraints) {
        keys.push({ name: key.getName(), kind: "unique_constraint", columns: key.columns.map(c => c.name) });
      }
      for (const index of c.indexes) {
        const cfg = index.config;
        const item = {
          name: cfg.name, unique: !!cfg.unique, columns: cfg.columns.map(c => c.name ?? null),
          partial: !!cfg.where, expression: cfg.columns.some(c => !c.name), method: cfg.method || "btree",
        };
        indexes.push(item);
        if (item.unique && !item.partial && !item.expression && item.method === "btree") {
          keys.push({ ...item, kind: "unique_index" });
        }
      }
      const types = new Set();
      for (const column of c.columns) {
        let current = column;
        while (current.baseColumn) current = current.baseColumn;
        if (current.enum) types.add((current.enum.schema || "public") + "." + current.enum.enumName);
      }
      return {
        id, name: c.name, schema: namespace, keys, indexes, types: [...types].sort(),
        checks: c.checks.map(check => ({ name: check.name, expression: dialect.sqlToQuery(check.value).sql })),
        foreignKeys: c.foreignKeys.map(fk => {
          const r = fk.reference(), parent = getTableConfig(r.foreignTable);
          return {
            name: fk.getName(), child: id, childColumns: r.columns.map(c => c.name),
            parent: (parent.schema || "public") + "." + parent.name,
            parentColumns: r.foreignColumns.map(c => c.name),
          };
        }),
      };
    }).sort((a, b) => a.id.localeCompare(b.id)),
  };
}
