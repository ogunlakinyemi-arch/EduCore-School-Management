import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { lex, readColumns, readIdentifier, readName, splitSql, symbol, word } from "./sql.mjs";

const sameTuple = (a, b) => a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");
const seek = (tokens, offset, value) => tokens.findIndex((t, i) => i >= offset && word(t, value));

// Static source evidence only. Conditional declarations are not execution evidence.
// Dynamic format()/loop-generated DDL is explicitly not guessed.
export function migrationEvidence(directory, dependencies) {
  const files = fs.readdirSync(directory).filter(f => /^\d{4}.*\.sql$/.test(f)).sort();
  const events = [], unresolved = [], hashes = {};
  let origin;
  function record(event) { events.push({ ...event, ...origin }); }
  function key(table, name, columns, kind) { record({ kind: "key", table, name, columns, ownership: kind }); }
  function foreign(tokens, offset, table, name) {
    const child = readColumns(tokens, offset), ref = seek(tokens, child.next, "references");
    if (ref < 0) throw new Error("Missing FK reference");
    const parent = readName(tokens, ref + 1), columns = readColumns(tokens, parent.next);
    record({ kind: "fk", table, name, columns: child.columns, parent: parent.id, parentColumns: columns.columns });
  }
  function definition(tokens, table) {
    if (word(tokens[0], "check") || word(tokens[0], "exclude")) return;
    let i = 0, name;
    if (word(tokens[0], "constraint")) { const n = readIdentifier(tokens, 1); name = n.name; i = n.next; }
    if (word(tokens[i], "foreign") && word(tokens[i + 1], "key")) {
      foreign(tokens, i + 2, table.id, name); return;
    }
    if (word(tokens[i], "primary") && word(tokens[i + 1], "key") || word(tokens[i], "unique")) {
      const primary = word(tokens[i], "primary"); i += primary ? 2 : 1;
      if (word(tokens[i], "using") && word(tokens[i + 1], "index")) {
        const index = readName(tokens, i + 2, table.schema);
        const previous = events.findLast(e => e.kind === "key" && e.table === table.id && e.name === index.name);
        if (!previous) throw new Error("UNIQUE USING INDEX source not resolved");
        key(table.id, name || index.name, previous.columns, "unique_constraint");
      } else {
        const columns = readColumns(tokens, i).columns;
        key(table.id, name || (primary ? table.name + "_pkey" : table.name + "_" + columns.join("_") + "_key"), columns, primary ? "primary" : "unique_constraint");
      }
      return;
    }
    // Column-level PK, UNIQUE and REFERENCES declarations.
    const column = readIdentifier(tokens, 0).name;
    const primary = seek(tokens, 1, "primary"), unique = seek(tokens, 1, "unique"), ref = seek(tokens, 1, "references");
    if (primary >= 0 && word(tokens[primary + 1], "key")) key(table.id, table.name + "_pkey", [column], "primary");
    if (unique >= 0) key(table.id, table.name + "_" + column + "_key", [column], "unique_constraint");
    if (ref >= 0) {
      const parent = readName(tokens, ref + 1), columns = readColumns(tokens, parent.next).columns;
      record({ kind: "fk", table: table.id, name: name || table.name + "_" + column + "_fkey", columns: [column], parent: parent.id, parentColumns: columns });
    }
  }
  function walk(tokens) {
    for (let i = 0; i < tokens.length; i++) {
      if (word(tokens[i], "do") && tokens[i + 1]?.kind === "dollar") walk(lex(tokens[i + 1].value));
      if (word(tokens[i], "execute") && tokens[i + 1]?.kind === "string") {
        const literal = tokens[i + 1].value;
        if (/^(CREATE|ALTER)\s/i.test(literal)) walk(lex(literal));
      }
      try {
        if (word(tokens[i], "create") && word(tokens[i + 1], "table")) {
          let j = i + 2; if (word(tokens[j], "if")) j += 3;
          const table = readName(tokens, j); j = table.next;
          record({ kind: "table", table: table.id, name: table.name });
          if (!symbol(tokens[j], "(")) continue;
          let depth = 0, start = j + 1;
          for (let k = j + 1; k < tokens.length; k++) {
            if (symbol(tokens[k], "(") || symbol(tokens[k], "[")) depth++;
            if ((symbol(tokens[k], ")") || symbol(tokens[k], "]")) && depth) depth--;
            else if (symbol(tokens[k], ")") || symbol(tokens[k], ",") && !depth) {
              const piece = tokens.slice(start, k);
              if (piece.length) {
                try { definition(piece, table); } catch (e) { unresolved.push({ ...origin, reason: e.message }); }
              }
              start = k + 1;
              if (symbol(tokens[k], ")")) { i = k; break; }
            }
          }
        } else if (word(tokens[i], "create") && word(tokens[i + 1], "unique") && word(tokens[i + 2], "index")) {
          let j = i + 3; if (word(tokens[j], "if")) j += 3;
          const index = readName(tokens, j), on = seek(tokens, index.next, "on");
          const table = readName(tokens, on + 1);
          j = table.next; if (word(tokens[j], "using")) j += 2;
          const columns = readColumns(tokens, j);
          // A WHERE clause before the next semicolon makes the index ineligible.
          const end = tokens.findIndex((t, k) => k >= columns.next && t.value === ";");
          const tail = tokens.slice(columns.next, end < 0 ? tokens.length : end);
          if (!tail.some(t => word(t, "where"))) key(table.id, index.name, columns.columns, "unique_index");
        } else if (word(tokens[i], "alter") && word(tokens[i + 1], "table")) {
          let j = i + 2; if (word(tokens[j], "only")) j++;
          if (word(tokens[j], "if")) j += 2;
          const table = readName(tokens, j); j = table.next;
          if (!word(tokens[j], "add")) continue;
          j++;
          if (!["constraint", "unique", "primary", "foreign"].some(w => word(tokens[j], w))) continue;
          const end = tokens.findIndex((t, k) => k >= j && symbol(t, ";"));
          definition(tokens.slice(j, end < 0 ? tokens.length : end), table);
        }
      } catch (e) { unresolved.push({ ...origin, reason: e.message }); }
    }
  }
  for (const file of files) {
    const sql = fs.readFileSync(path.join(directory, file), "utf8");
    hashes[file] = createHash("sha256").update(sql).digest("hex");
    const statements = splitSql(sql);
    statements.forEach((statement, i) => { origin = { migration: file, statement: i + 1 }; walk(lex(statement)); });
  }
  function matches(candidates, name) {
    const exact = candidates.filter(e => e.name === name);
    return { exactName: exact.length > 0, declarations: (exact.length ? exact : candidates).map(e => ({
      migration: e.migration, statement: e.statement, name: e.name, ownership: e.ownership,
    })) };
  }
  const foreignKeys = dependencies.map(fk => {
    const parentTable = events.filter(e => e.kind === "table" && e.table === fk.parent);
    const keys = events.filter(e => e.kind === "key" && e.table === fk.parent && sameTuple(e.columns, fk.parentColumns));
    const fks = events.filter(e => e.kind === "fk" && e.table === fk.child && e.parent === fk.parent &&
      JSON.stringify(e.columns) === JSON.stringify(fk.childColumns) && JSON.stringify(e.parentColumns) === JSON.stringify(fk.parentColumns));
    const keySource = matches(keys, fk.support.name), fkSource = matches(fks, fk.name);
    return {
      name: fk.name, child: fk.child, parent: fk.parent,
      parentTableDeclarations: parentTable.map(e => ({ migration: e.migration, statement: e.statement })),
      supportingKey: keySource, foreignKey: fkSource,
      keyVerification: keys.length ? (keySource.exactName ? "Static exact-name/tuple declaration" : "NOT VERIFIED — REASON: equivalent tuple declarations exist, but the selected model key ownership/name has no exact historical declaration.") : "NOT VERIFIED — REASON: no statically resolvable qualifying key declaration; dynamic/conditional DDL or model/history discrepancy requires separate provenance review.",
      fkVerification: fks.length ? (fkSource.exactName ? "Static exact-name/tuple declaration" : "NOT VERIFIED — REASON: the same FK tuple has a different historical name; the current model name's creation is not verified.") : "NOT VERIFIED — REASON: no statically resolvable matching FK tuple in the 60-file history; do not infer migration provenance.",
    };
  });
  return { migrationHashes: hashes, foreignKeys, unresolvedStaticDeclarations: unresolved,
    note: "Read-only static declaration inventory, not a claim that historical statements executed. Functions are not searched for incidental DDL; dynamic format()/loop-generated identifiers are not invented." };
}
