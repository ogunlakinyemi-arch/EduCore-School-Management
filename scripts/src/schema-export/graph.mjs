import { createHash } from "node:crypto";
import { inlineKeys, parseStatement, postgresIdentifier, splitSql } from "./sql.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tuple = columns => [...columns].sort().join("\0");
const keyPriority = { primary: 0, unique_constraint: 1, unique_index: 2 };

// SCCs document relational cycles without changing FK enforcement/deferrability.
export function tableComponents(model) {
  const tables = model.tables.map(t => t.id).sort(), edges = model.tables.flatMap(t => t.foreignKeys);
  const adjacency = new Map(tables.map(t => [t, []]));
  for (const fk of edges) {
    if (!adjacency.has(fk.parent)) throw new Error("Missing parent table for " + fk.name);
    adjacency.get(fk.child).push(fk.parent);
  }
  let next = 0; const stack = [], active = new Set(), index = new Map(), low = new Map(), components = [];
  function visit(v) {
    index.set(v, next); low.set(v, next++); stack.push(v); active.add(v);
    for (const w of adjacency.get(v).sort()) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (active.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (index.get(v) === low.get(v)) {
      const component = []; let w;
      do { w = stack.pop(); active.delete(w); component.push(w); } while (w !== v);
      components.push(component.sort());
    }
  }
  for (const table of tables) if (!index.has(table)) visit(table);
  const componentOf = new Map(components.flatMap((c, i) => c.map(t => [t, i])));
  const dependencies = components.map(() => new Set());
  for (const fk of edges) if (componentOf.get(fk.child) !== componentOf.get(fk.parent)) {
    dependencies[componentOf.get(fk.child)].add(componentOf.get(fk.parent));
  }
  const order = [], done = new Set();
  while (done.size < components.length) {
    const ready = components.map((c, i) => i).filter(i => !done.has(i) && [...dependencies[i]].every(d => done.has(d)));
    ready.sort((a, b) => components[a][0].localeCompare(components[b][0]));
    if (!ready.length) throw new Error("Cannot order condensed table graph");
    for (const i of ready) { order.push(...components[i]); done.add(i); }
  }
  const cycles = components.map(c => ({
    tables: c, foreignKeys: edges.filter(f => c.includes(f.child) && c.includes(f.parent)),
    mechanism: "Create tables and existing keys first; add unchanged FK definitions afterwards. No DEFERRABLE/NOT VALID or data changes.",
  })).filter(c => c.tables.length > 1 || c.foreignKeys.some(f => f.child === f.parent));
  return { order, cycles };
}

export function orderExport(rawSql, model) {
  const raw = splitSql(rawSql), tables = new Map(model.tables.map(t => [t.id, t]));
  if (tables.size !== model.tables.length) throw new Error("Duplicate model table");
  const physicalRelations = new Set();
  function physicalRelation(schema, name) {
    const id = postgresIdentifier(schema) + "." + postgresIdentifier(name);
    if (physicalRelations.has(id)) throw new Error("PostgreSQL identifier collision in relation/index namespace: " + id);
    physicalRelations.add(id);
  }
  for (const table of model.tables) {
    physicalRelation(table.schema, table.name);
    for (const index of table.indexes) physicalRelation(table.schema, index.name);
    for (const key of table.keys.filter(k => k.kind !== "unique_index")) physicalRelation(table.schema, key.name);
    const constraints = new Set();
    for (const object of [...table.keys.filter(k => k.kind !== "unique_index"), ...(table.checks || []), ...table.foreignKeys]) {
      const name = postgresIdentifier(object.name);
      if (constraints.has(name)) throw new Error("PostgreSQL constraint identifier collision on " + table.id + ": " + name);
      constraints.add(name);
    }
  }
  const components = tableComponents(model), tableRank = new Map(components.order.map((t, i) => [t, i]));
  const nodes = new Map(), tableNodes = new Map(), indexNodes = new Map(), fkNodes = new Map(), typeNodes = new Map(), schemaNodes = new Map();
  function add(id, node) {
    if (nodes.has(id)) throw new Error("Duplicate exported object: " + id);
    nodes.set(id, { id, dependencies: [], ...node }); return id;
  }
  for (const sql of raw) {
    const p = parseStatement(sql); let id;
    if (p.kind === "table") {
      if (!tables.has(p.id)) throw new Error("Exported table absent from model: " + p.id);
      id = add("table:" + p.id, { kind: "table", rank: 1, tableRank: tableRank.get(p.id), sql, object: p.id });
      tableNodes.set(p.id, id);
    } else if (p.kind === "index") {
      id = add("index:" + p.id, { kind: p.unique ? "unique_index" : "index", rank: p.unique ? 3 : 4, sql, object: p.id, table: p.table, partial: p.partial, columns: p.columns });
      indexNodes.set(p.id, id);
    } else if (p.kind === "fk") {
      const fk = tables.get(p.table)?.foreignKeys.find(f => f.name === p.name);
      if (!fk || !equal(fk.childColumns, p.childColumns) || fk.parent !== p.parent || !equal(fk.parentColumns, p.parentColumns)) {
        throw new Error("Export/model foreign-key mismatch: " + p.name);
      }
      id = add("fk:" + p.table + ":" + p.name, { kind: "fk", rank: 6, sql, object: p.name, fk });
      fkNodes.set(p.table + ":" + p.name, id);
    } else if (p.kind === "type") {
      id = add("type:" + p.id, { kind: "type", rank: 0, sql, object: p.id }); typeNodes.set(p.id, id);
    } else if (p.kind === "schema") {
      id = add("schema:" + p.name, { kind: "schema", rank: -1, sql, object: p.name }); schemaNodes.set(p.name, id);
    }
  }
  const keyNodes = new Map(), names = new Set();
  for (const t of model.tables) {
    const tableNode = tableNodes.get(t.id);
    if (!tableNode) throw new Error("Missing table statement: " + t.id);
    let declaredKeys;
    try { declaredKeys = inlineKeys(nodes.get(tableNode).sql); }
    catch (error) { throw new Error("Cannot inspect inline keys for " + t.id + ": " + error.message); }
    if (t.schema !== "public") {
      const schema = schemaNodes.get(t.schema); if (!schema) throw new Error("Missing schema statement: " + t.schema);
      nodes.get(tableNode).dependencies.push(schema);
    }
    for (const type of t.types || []) {
      if (!typeNodes.has(type)) throw new Error("Missing required enum: " + type);
      nodes.get(tableNode).dependencies.push(typeNodes.get(type));
    }
    for (const index of t.indexes) {
      const id = indexNodes.get(t.schema + "." + index.name);
      if (!id || nodes.get(id).table !== t.id) throw new Error("Missing/mismatched model index: " + index.name);
      if ((nodes.get(id).kind === "unique_index") !== index.unique || nodes.get(id).partial !== index.partial) throw new Error("Index uniqueness/predicate export/model mismatch: " + index.name);
      nodes.get(id).dependencies.push(tableNode);
    }
    for (const key of t.keys) {
      const namespace = t.schema + "." + key.name;
      if (names.has(namespace)) throw new Error("Conflicting supporting-index namespace: " + namespace);
      names.add(namespace);
      let node;
      if (key.kind === "unique_index") {
        node = indexNodes.get(namespace);
        if (!node || !equal(nodes.get(node).columns, key.columns)) throw new Error("Supporting index column export/model mismatch: " + namespace);
      }
      else {
        if (indexNodes.has(namespace)) throw new Error("Index conflicts with existing inline key: " + namespace);
        if (!declaredKeys.some(k => k.kind === key.kind && (!k.name || k.name === key.name) && equal(k.columns, key.columns))) {
          throw new Error("Model key absent from CREATE TABLE: " + t.id + ":" + key.name);
        }
        node = add("key:" + t.id + ":" + key.name, {
          kind: key.kind, rank: 2, object: key.name, table: t.id, dependencies: [tableNode], sql: null,
        });
      }
      if (!node) throw new Error("Missing supporting key statement: " + key.name);
      keyNodes.set(t.id + ":" + key.name, node);
    }
  }
  for (const [name, id] of typeNodes) {
    const schema = name.slice(0, name.indexOf("."));
    if (schema !== "public") {
      if (!schemaNodes.has(schema)) throw new Error("Missing type schema: " + schema);
      nodes.get(id).dependencies.push(schemaNodes.get(schema));
    }
  }
  for (const [id, node] of indexNodes) {
    const n = nodes.get(node), t = tables.get(n.table);
    if (!t?.indexes.some(i => t.schema + "." + i.name === id)) throw new Error("Index absent from schema model: " + id);
  }
  const foreignKeys = [];
  for (const t of model.tables) for (const fk of t.foreignKeys) {
    const nodeId = fkNodes.get(fk.child + ":" + fk.name);
    if (!nodeId) throw new Error("Missing FK SQL statement: " + fk.name);
    if (new Set(fk.parentColumns).size !== fk.parentColumns.length) throw new Error("Repeated FK target column: " + fk.name);
    const candidates = tables.get(fk.parent).keys.filter(k =>
      !k.partial && !k.expression && k.kind in keyPriority &&
      k.columns.length === fk.parentColumns.length && tuple(k.columns) === tuple(fk.parentColumns),
    ).sort((a, b) => keyPriority[a.kind] - keyPriority[b.kind] || a.name.localeCompare(b.name));
    const support = candidates[0];
    if (!support) throw new Error("No qualifying PRIMARY/UNIQUE key for " + fk.name + " -> " + fk.parent + "(" + fk.parentColumns.join(",") + "); non-unique, partial and expression indexes are not valid support");
    const supportNode = keyNodes.get(fk.parent + ":" + support.name);
    nodes.get(nodeId).dependencies.push(tableNodes.get(fk.child), tableNodes.get(fk.parent), supportNode);
    foreignKeys.push({ ...fk, physicalName: postgresIdentifier(fk.name),
      support: { ...support, physicalName: postgresIdentifier(support.name), table: fk.parent },
      supportNode, foreignKeyNode: nodeId, alternativeSupports: candidates.slice(1).map(k => ({ name: k.name, physicalName: postgresIdentifier(k.name), kind: k.kind })) });
  }
  const orderedNodes = [], emitted = new Set();
  const compare = (a, b) => a.rank - b.rank || (a.tableRank ?? 0) - (b.tableRank ?? 0) || a.id.localeCompare(b.id);
  while (emitted.size < nodes.size) {
    const ready = [...nodes.values()].filter(n => !emitted.has(n.id) && n.dependencies.every(d => emitted.has(d))).sort(compare);
    if (!ready.length) throw new Error("Unresolved schema-object dependency cycle");
    // One node at a time preserves global phase priority as new nodes become ready.
    const node = ready[0]; orderedNodes.push(node); emitted.add(node.id);
  }
  const statements = orderedNodes.filter(n => n.sql).map(n => n.sql);
  const rawMultiset = digest([...raw].sort().join("\n"));
  if (rawMultiset !== digest([...statements].sort().join("\n"))) throw new Error("Export statement multiset changed");
  return {
    statements, foreignKeys, cycles: components.cycles,
    nodes: orderedNodes.map(({ sql, ...n }) => ({ ...n, statementSha256: sql ? digest(sql) : null })),
    rawStatementMultisetSha256: rawMultiset, statementCount: raw.length,
    note: "Only existing statements reordered. PK/UNIQUE/CHECK clauses remain inline in CREATE TABLE. All standalone indexes precede FK ALTER statements. Current exporter emits no functions, triggers, extensions or backfills; unsupported statements fail closed.",
  };
}
