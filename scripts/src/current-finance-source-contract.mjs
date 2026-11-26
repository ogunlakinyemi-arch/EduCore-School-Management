// Strict offline reader for the limited, reviewed CREATE TABLE/ALTER dialect.
// Not a SQL executor or general-purpose PostgreSQL parser.
import assert from "node:assert/strict";
export function normalize(value) {
  let result = "", quote = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "'") {
      result += c;
      if (quote && value[i + 1] === "'") { result += value[++i]; continue; }
      quote = !quote; continue;
    }
    if (quote) result += c;
    else if (!/\s/.test(c)) result += c.toLowerCase();
  }
  return result;
}
export function splitTop(value) {
  let start = 0, depth = 0, quote = false;
  const parts = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "'") {
      if (quote && value[i + 1] === "'") { i++; continue; }
      quote = !quote;
    }
    if (quote) continue;
    if (value[i] === "(") depth++;
    if (value[i] === ")") depth--;
    if (value[i] === "," && depth === 0) { parts.push(value.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(value.slice(start).trim());
  assert.equal(depth, 0); assert.equal(quote, false);
  return parts;
}
function enclosed(value, start) {
  assert.equal(value[start], "(");
  let depth = 0, quote = false;
  for (let i = start; i < value.length; i++) {
    if (value[i] === "'") {
      if (quote && value[i + 1] === "'") { i++; continue; }
      quote = !quote;
    }
    if (quote) continue;
    if (value[i] === "(") depth++;
    if (value[i] === ")" && --depth === 0) return { body: value.slice(start + 1, i), end: i + 1 };
  }
  throw new Error("Unclosed source expression");
}
// Independent implementation of PostgreSQL's ASCII default constraint naming.
function keyName(table, columns, suffix) {
  let left = table, right = columns.join("_");
  while (left.length + right.length + suffix.length + (right ? 2 : 1) > 63) {
    if (left.length > right.length) left = left.slice(0, -1); else right = right.slice(0, -1);
  }
  return [left, right, suffix].filter(Boolean).join("_");
}
const list = value => value.split(",").map(x => x.trim());
function addPart(table, part) {
  const named = part.match(/^CONSTRAINT\s+(\w+)\s+/i);
  const name = named?.[1];
  if (named) part = part.slice(named[0].length);
  if (/^CHECK\s*\(/i.test(part)) {
    const i = table.checks.filter(x => /^.+_check\d*$/.test(x.name) && x.tableLevel).length;
    table.checks.push({ name: name ?? `${table.name}_check${i || ""}`, expression: enclosed(part, part.indexOf("(")).body, tableLevel: true });
    return;
  }
  if (/^(UNIQUE|PRIMARY KEY)\s*\(/i.test(part)) {
    const columns = list(enclosed(part, part.indexOf("(")).body);
    table.keys.push({ name: name ?? keyName(table.name, /^UNIQUE/i.test(part) ? columns : [], /^UNIQUE/i.test(part) ? "key" : "pkey"),
      columns, primary: /^PRIMARY/i.test(part) }); return;
  }
  const column = part.match(/^(\w+)\s+(bigserial|bigint|serial|integer|text|jsonb|timestamptz|boolean|date)\b/i);
  assert.ok(column, `Unsupported source column: ${part}`);
  const [, columnName, type] = column;
  const primary = /\bPRIMARY KEY\b/i.test(part);
  const defaultMatch = part.match(/\bDEFAULT\s+(.+?)(?=\s+(?:CHECK|REFERENCES|NOT NULL|UNIQUE|PRIMARY KEY)\b|$)/i);
  table.columns.push({ name: columnName, type: type.toLowerCase(), notNull: primary || /\bNOT NULL\b/i.test(part), default: defaultMatch?.[1] ?? null });
  if (primary) table.keys.push({ name: `${table.name}_pkey`, columns: [columnName], primary: true });
  if (/\bUNIQUE\b/i.test(part)) table.keys.push({ name: keyName(table.name, [columnName], "key"), columns: [columnName], primary: false });
  const ref = part.match(/\bREFERENCES\s+(\w+)\((\w+)\)(?:\s+ON DELETE\s+(RESTRICT))?/i);
  if (ref) table.foreignKeys.push({ name: keyName(table.name, [columnName], "fkey"), columns: [columnName],
    parent: ref[1], parentColumns: [ref[2]], onDelete: ref[3] ? "restrict" : "no action", onUpdate: "no action" });
  const check = part.match(/\bCHECK\s*\(/i);
  if (check) {
    const expression = enclosed(part, part.indexOf("(", check.index)).body;
    const withoutStrings = expression.replace(/'(?:''|[^'])*'/g, "");
    const multiColumn = table.columns.some(c => c.name !== columnName && new RegExp(`\\b${c.name}\\b`).test(withoutStrings));
    table.checks.push({ name: keyName(table.name, multiColumn ? [] : [columnName], "check"), expression, tableLevel: multiColumn });
  }
}
export function readSourceContract(sources) {
  const tables = new Map(), sql = sources.join("\n").replace(/--[^\n]*/g, "");
  for (const match of sql.matchAll(/CREATE TABLE\s+(\w+)\s*\(/gi)) {
    const table = { name: match[1], columns: [], keys: [], foreignKeys: [], checks: [], indexes: [] };
    assert.ok(!tables.has(table.name), `Duplicate source table: ${table.name}`);
    for (const part of splitTop(enclosed(sql, match.index + match[0].length - 1).body)) addPart(table, part);
    tables.set(table.name, table);
  }
  for (const match of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+([^;]+);/gi)) {
    const table = tables.get(match[1]); assert.ok(table);
    for (const part of splitTop(match[2])) addPart(table, part.replace(/^ADD COLUMN\s+/i, ""));
  }
  for (const match of sql.matchAll(/ALTER TABLE\s+(\w+)\s+DROP CONSTRAINT\s+(\w+);/gi)) {
    const table = tables.get(match[1]); assert.ok(table?.checks.some(c => c.name === match[2]));
    table.checks = table.checks.filter(c => c.name !== match[2]);
  }
  for (const match of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD CONSTRAINT\s+(\w+)\s+CHECK\s*\(/gi)) {
    const table = tables.get(match[1]); assert.ok(table);
    table.checks.push({ name: match[2], expression: enclosed(sql, match.index + match[0].length - 1).body });
  }
  for (const match of sql.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)(?:\s+WHERE\s+([^;]+))?;/gi)) {
    const table = tables.get(match[3]); assert.ok(table);
    table.indexes.push({ name: match[2], unique: !!match[1], columns: list(match[4]).map(c => {
      const [name, order = "asc"] = c.split(/\s+/);
      return { name, order: order.toLowerCase(), nulls: order.toLowerCase() === "desc" ? "first" : "last" };
    }), where: match[5] ?? null });
  }
  return tables;
}
