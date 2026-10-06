# Dependency-aware schema audit export

Generate only; this command has **no database connection or execution capability**:

```sh
pnpm --filter @workspace/scripts run export:schema:audit --out /tmp/educore-audit.sql
pnpm --filter @workspace/scripts run test:schema-export
```

SQL and its `.graph.json` companion are labelled:
**DISPOSABLE / AUDIT ONLY — NOT FOR PRODUCTION EXECUTION**.
Only `/tmp/*.sql` or workspace `reports/**/*.sql` output paths are accepted.
Symlink targets, migration directories, execution flags and database URLs are rejected.

## Ordering and ownership

The utility imports only the Drizzle schema barrel, not the database client, and
runs standalone Drizzle export with explicit dialect/schema arguments and a
credential-free subprocess environment. A source-hash check rejects concurrent
schema edits. No configuration, journal or ledger is loaded by the exporter.

The object DAG explicitly records parent-table → existing supporting-key → FK,
plus child-table → FK and schema/enum → table edges. FK support must be an exact
column-set PRIMARY KEY, UNIQUE constraint or nonpartial, nonexpression btree
UNIQUE index. Ordinary indexes cannot qualify. A qualifying inline constraint is
preferred over an equivalent standalone index; no key is synthesized.

Stable topological ordering creates schema/enums, parent-first table components,
existing supporting keys, other indexes, then FKs. PK, UNIQUE and CHECK clauses
already inline in CREATE TABLE stay inline: separating them would needlessly
rewrite SQL. Self/circular table references are documented as strongly connected
components with every participating FK edge. They use the existing standalone
ALTER TABLE FK architecture after tables/keys exist; enforcement semantics,
`DEFERRABLE`, `NOT VALID`, names and actions are not changed.

An exact DDL-statement multiset hash proves permutation only. Duplicate object
names fail; existing equivalent index representations are retained rather than
dropped/renamed or recreated. No new index, constraint or data-changing statement
is generated. The present model emits no extensions, functions, triggers or
backfills. Unknown directives fail closed instead of being silently reordered,
omitted or copied from historical migrations.

Logical names remain verbatim in SQL. The manifest also records PostgreSQL's
UTF-8-safe 63-byte physical identifier form for catalog matching, and rejects
physical-name collisions. Identifier truncation is not a reason to rename
historical or model constraints.

## Migration evidence is not execution history

Every FK includes read-only static parent-key and FK declaration evidence from
the SQL files. Literal declarations inside DO blocks and UNIQUE USING INDEX are
recognized. Functions, dynamic `format()` identifiers and loop-generated DDL
are not treated as known execution routes. Equivalent tuple evidence is kept
separate from exact name/ownership evidence. Missing or different-name provenance
is marked **NOT VERIFIED — REASON**, never fabricated. These gaps do not prevent
validation of a well-defined current model, but still block canonical-history or
Production-readiness claims.

Run emitted SQL only against an explicitly verified disposable PostgreSQL
cluster. Never feed it to shared Development/Production, migration/push tools,
automatic hooks or deployment.
