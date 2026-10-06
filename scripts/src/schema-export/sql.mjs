// Read-only SQL lexer. Statements are retained verbatim, never regenerated.
export function lex(sql) {
  const tokens = [];
  for (let i = 0; i < sql.length;) {
    const start = i, c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (sql.startsWith("--", i)) {
      i = sql.indexOf("\n", i); if (i < 0) break; continue;
    }
    if (sql.startsWith("/*", i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) { depth++; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error("Unterminated SQL comment");
      continue;
    }
    if (c === "'" || c === '"') {
      const escaped = c === "'" && /(?:^|\W)[eE]$/.test(sql.slice(0, i));
      let value = "", closed = false; i++;
      while (i < sql.length) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) { value += c; i += 2; }
          else { i++; closed = true; break; }
        } else if (escaped && sql[i] === "\\") {
          value += sql.slice(i, i + 2); i += 2;
        } else value += sql[i++];
      }
      if (!closed) throw new Error("Unterminated SQL quote");
      tokens.push({ kind: c === '"' ? "identifier" : "string", value, start, end: i });
      continue;
    }
    const dollar = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length);
      if (end < 0) throw new Error("Unterminated dollar-quoted SQL");
      i = end + dollar.length;
      tokens.push({ kind: "dollar", value: sql.slice(start + dollar.length, end), start, end: i });
      continue;
    }
    const word = sql.slice(i).match(/^[A-Za-z_][A-Za-z_0-9$]*/)?.[0];
    if (word) {
      i += word.length; tokens.push({ kind: "word", value: word.toLowerCase(), start, end: i });
    } else {
      i++; tokens.push({ kind: "symbol", value: c, start, end: i });
    }
  }
  return tokens;
}

export function splitSql(sql) {
  const result = []; let start = 0;
  for (const t of lex(sql)) if (t.kind === "symbol" && t.value === ";") {
    const statement = sql.slice(start, t.end).trim();
    if (lex(statement).some(t => t.value !== ";")) result.push(statement);
    start = t.end;
  }
  const tail = sql.slice(start).trim();
  if (lex(tail).length) throw new Error("Export contains an unterminated SQL statement");
  return result;
}

export const word = (t, value) => t?.kind === "word" && t.value === value;
export const symbol = (t, value) => t?.kind === "symbol" && t.value === value;
export function postgresIdentifier(name) {
  const bytes = Buffer.from(name, "utf8");
  if (bytes.length <= 63) return name;
  let end = 63;
  while ((bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}
export function readIdentifier(tokens, offset) {
  const t = tokens[offset];
  if (!t || !["identifier", "word"].includes(t.kind)) throw new Error("Expected SQL identifier");
  return { name: t.value, next: offset + 1 };
}
export function readName(tokens, offset, defaultSchema = "public") {
  const first = readIdentifier(tokens, offset);
  if (symbol(tokens[first.next], ".")) {
    const last = readIdentifier(tokens, first.next + 1);
    return { schema: first.name, name: last.name, id: first.name + "." + last.name, next: last.next };
  }
  return { schema: defaultSchema, name: first.name, id: defaultSchema + "." + first.name, next: first.next };
}
export function readColumns(tokens, offset) {
  if (!symbol(tokens[offset], "(")) throw new Error("Expected key column list");
  const columns = []; let i = offset + 1;
  while (!symbol(tokens[i], ")")) {
    const c = readIdentifier(tokens, i); columns.push(c.name); i = c.next;
    if (symbol(tokens[i], ",")) i++;
    else if (!symbol(tokens[i], ")")) throw new Error("Expressions cannot support a foreign key");
  }
  return { columns, next: i + 1 };
}

export function inlineKeys(sql) {
  const t = lex(sql), table = readName(t, 2), keys = [];
  let start = table.next + 1, depth = 0;
  for (let i = start; i < t.length; i++) {
    if (symbol(t[i], "(") || symbol(t[i], "[")) depth++;
    else if ((symbol(t[i], ")") || symbol(t[i], "]")) && depth) depth--;
    else if (symbol(t[i], ",") && !depth || symbol(t[i], ")") && !depth) {
      const part = t.slice(start, i); let offset = 0, name;
      if (word(part[0], "constraint")) {
        const n = readIdentifier(part, 1); name = n.name; offset = n.next;
      }
      if (word(part[offset], "primary") && word(part[offset + 1], "key")) {
        keys.push({ kind: "primary", name: name || table.name + "_pkey", columns: readColumns(part, offset + 2).columns });
      } else if (word(part[offset], "unique")) {
        const list = part.findIndex((x, n) => n > offset && symbol(x, "("));
        keys.push({ kind: "unique_constraint", name, columns: readColumns(part, list).columns });
      } else if (!word(part[0], "constraint") && part.length) {
        const column = readIdentifier(part, 0).name;
        if (part.some((x, n) => word(x, "primary") && word(part[n + 1], "key"))) {
          keys.push({ kind: "primary", name: table.name + "_pkey", columns: [column] });
        }
        if (part.some(x => word(x, "unique"))) {
          const constraint = part.findIndex(x => word(x, "constraint"));
          keys.push({ kind: "unique_constraint", name: constraint >= 0 ? readIdentifier(part, constraint + 1).name : undefined, columns: [column] });
        }
      }
      start = i + 1;
      if (symbol(t[i], ")")) break;
    }
  }
  return keys;
}

function indexColumns(tokens, offset) {
  while (offset < tokens.length && !symbol(tokens[offset], "(")) offset++;
  let start = offset + 1, depth = 0; const columns = [];
  for (let i = start; i < tokens.length; i++) {
    if (symbol(tokens[i], "(") || symbol(tokens[i], "[")) depth++;
    else if ((symbol(tokens[i], ")") || symbol(tokens[i], "]")) && depth) depth--;
    else if (symbol(tokens[i], ",") && !depth || symbol(tokens[i], ")") && !depth) {
      const part = tokens.slice(start, i);
      const simple = ["word", "identifier"].includes(part[0]?.kind) &&
        part.slice(1).every(t => t.kind === "word" && ["asc", "desc", "nulls", "first", "last"].includes(t.value));
      columns.push(simple ? part[0].value : null);
      start = i + 1;
      if (symbol(tokens[i], ")")) break;
    }
  }
  return columns;
}

export function parseStatement(sql) {
  const t = lex(sql);
  if (word(t[0], "create") && word(t[1], "table")) {
    return { kind: "table", ...readName(t, 2) };
  }
  if (word(t[0], "create") && (word(t[1], "index") || word(t[1], "unique") && word(t[2], "index"))) {
    const unique = word(t[1], "unique"), index = readName(t, unique ? 3 : 2);
    if (!word(t[index.next], "on")) throw new Error("Unsupported CREATE INDEX header");
    const table = readName(t, index.next + 1);
    return { kind: "index", name: index.name, id: table.schema + "." + index.name, table: table.id, unique,
      partial: t.some(token => word(token, "where")), columns: indexColumns(t, table.next) };
  }
  if (word(t[0], "alter") && word(t[1], "table")) {
    const table = readName(t, 2); let i = table.next;
    if (!word(t[i++], "add") || !word(t[i++], "constraint")) throw new Error("Only standalone FK ALTER TABLE is supported");
    const name = readIdentifier(t, i); i = name.next;
    if (!word(t[i++], "foreign") || !word(t[i++], "key")) throw new Error("Export ALTER TABLE must add a foreign key");
    const child = readColumns(t, i); i = child.next;
    if (!word(t[i++], "references")) throw new Error("Missing FK parent");
    const parent = readName(t, i), columns = readColumns(t, parent.next);
    return { kind: "fk", name: name.name, table: table.id, childColumns: child.columns, parent: parent.id, parentColumns: columns.columns };
  }
  if (word(t[0], "create") && word(t[1], "type")) {
    const name = readName(t, 2);
    if (!word(t[name.next], "as") || !word(t[name.next + 1], "enum")) throw new Error("Only exported enum types are supported");
    return { kind: "type", ...name };
  }
  if (word(t[0], "create") && word(t[1], "schema")) return { kind: "schema", ...readName(t, 2) };
  throw new Error("Unsupported export statement (functions, triggers, extensions and backfills are not emitted by the current model): " + sql.slice(0, 100));
}
