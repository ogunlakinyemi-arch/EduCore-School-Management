#!/usr/bin/env node
/**
 * Offline-only consistency checks for the production reconciliation package.
 * Reads the three cited migration sources and the SQL/Markdown package files.
 * Does not access a database, environment variables, network, providers, or app.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  sql: 'reports/production-sql-reconciliation-package-2026-10-01.sql',
  report: 'reports/production-sql-reconciliation-package-2026-10-01.md',
  migration0010: 'lib/db/drizzle/0010_historical_device_school_bindings.sql',
  migration0013: 'lib/db/drizzle/0013_phase7_finance.sql',
  migration0029: 'lib/db/drizzle/0029_operations_history.sql',
};
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const sql = read(paths.sql);
const report = read(paths.report);
const sourceByPath = {
  [paths.migration0010]: read(paths.migration0010),
  [paths.migration0013]: read(paths.migration0013),
  [paths.migration0029]: read(paths.migration0029),
};
const fail = (message) => assert.fail(message);
const normalizeDelimiterNewlines = (body) => body.replace(/^[\r\n]+|[\r\n]+$/g, '');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sectionBetween(text, startMarker, endMarker = null) {
  const start = text.indexOf(startMarker);
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : text.length;
  assert(start >= 0, `missing section start: ${startMarker}`);
  assert(end >= 0, `missing section end: ${endMarker}`);
  return text.slice(start, end).trimEnd();
}

// Function body literals are compared directly to their authoritative source.
const functionSources = [
  ['prevent_device_school_binding_mutation', paths.migration0010],
  ['protect_fee_payment_verification_metadata', paths.migration0013],
  ['prevent_operations_history_mutation', paths.migration0029],
];
const functionSection = sectionBetween(sql, '-- SECTION: FUNCTIONS', '-- SECTION: TRIGGERS');
assert.equal(
  (functionSection.match(/CREATE OR REPLACE FUNCTION public\./g) ?? []).length,
  3,
  'expected one absent-only CREATE OR REPLACE template for each guarded function',
);
assert(
  functionSection.includes(
    "IF pg_catalog.to_regprocedure('public.' || pg_catalog.quote_ident(spec.function_name) || '()') IS NULL THEN\n      EXECUTE spec.create_sql;\n    END IF;",
  ),
  'CREATE OR REPLACE templates must execute only behind the exact-signature-absent guard',
);

for (const [name, sourcePath] of functionSources) {
  const migration = sourceByPath[sourcePath];
  const sourceMatch = migration.match(
    new RegExp(`CREATE(?: OR REPLACE)? FUNCTION\\s+"${escapeRegExp(name)}"\\s*\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`),
  );
  assert(sourceMatch, `source function body not found: ${name}`);
  const sourceBody = normalizeDelimiterNewlines(sourceMatch[1]);
  const expectedPattern = new RegExp(`\\('${escapeRegExp(name)}',\\s*\\$expected\\$([\\s\\S]*?)\\$expected\\$`, 'g');
  const expectedBodies = [...functionSection.matchAll(expectedPattern)].map((match) => match[1]);
  assert.equal(expectedBodies.length, 3, `expected three guarded body copies for ${name}`);
  for (const body of expectedBodies) {
    assert.equal(body, sourceBody, `guarded source prosrc body differs for ${name}`);
  }
  const createPattern = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${escapeRegExp(name)}\\(\\)\\s+RETURNS trigger LANGUAGE plpgsql AS \\$body\\$([\\s\\S]*?)\\$body\\$;`,
    'g',
  );
  const createBodies = [...functionSection.matchAll(createPattern)].map((match) => normalizeDelimiterNewlines(match[1]));
  assert.equal(createBodies.length, 1, `expected one absent-only create template for ${name}`);
  for (const body of createBodies) {
    assert.equal(body, sourceBody, `created function body differs from source for ${name}`);
  }
}
for (const requiredGuard of [
  'p.pronargs',
  'p.prorettype',
  'p.prokind',
  'p.prosecdef',
  'p.provolatile',
  'p.proparallel',
  'p.proisstrict',
  'p.proleakproof',
  'p.proconfig',
  'p.prosrc',
  'l.lanname',
  'pg_catalog.btrim',
]) {
  assert(functionSection.includes(requiredGuard), `missing live-function guard: ${requiredGuard}`);
}
for (const rejectingGuard of [
  'actual.prorettype<>pg_catalog.to_regtype',
  'pg_catalog.btrim(actual.prosrc,E\'\\r\\n\') IS DISTINCT FROM spec.expected_body',
  'actual.prosecdef',
  "actual.provolatile<>'v'",
  "actual.proparallel<>'u'",
  'actual.proconfig IS NOT NULL',
]) {
  assert(functionSection.includes(rejectingGuard), `unsafe function drift is not rejected: ${rejectingGuard}`);
}
assert(
  functionSection.indexOf('conflicting or unsafe existing function definition') <
    functionSection.indexOf('EXECUTE spec.create_sql'),
  'all existing function drift must be checked before any creation',
);
assert(
  functionSection.indexOf('CREATE OR REPLACE FUNCTION') >
    functionSection.indexOf('conflicting or unsafe existing function definition') &&
    functionSection.indexOf('CREATE OR REPLACE FUNCTION') <
      functionSection.indexOf('EXECUTE spec.create_sql'),
  'CREATE OR REPLACE templates must be declared after drift validation and remain behind the absent-only execution guard',
);
assert(functionSection.includes('unexpected overloaded function exists'), 'unexpected overload must fail closed');
assert(/templates below execute only when the exact public/i.test(functionSection), 'function templates must be explicitly absent-only');
assert(/Matching functions remain a no-op/i.test(functionSection), 'matching function definitions must be a no-op');
assert(sql.indexOf('immediate function protection verification failed') < sql.indexOf('-- SECTION: TRIGGERS'));
assert(sql.indexOf('immediate trigger protection verification failed') < sql.indexOf('-- SECTION: BACKFILLS'));

// Parse the six source CREATE TRIGGER statements and compare the installer map.
const sourceTriggers = new Map();
const sourceTriggerPattern =
  /CREATE TRIGGER\s+"([^"]+)"\s+BEFORE\s+([\s\S]*?)\s+ON\s+"([^"]+)"\s+FOR EACH (ROW|STATEMENT)\s+EXECUTE FUNCTION\s+"([^"]+)"\(\);/g;
for (const migration of Object.values(sourceByPath)) {
  for (const match of migration.matchAll(sourceTriggerPattern)) {
    const [, name, event, table, granularity, functionName] = match;
    const normalizedEvent = event.trim().replace(/\s+/g, ' ');
    let bits = 2 + (granularity === 'ROW' ? 1 : 0);
    if (normalizedEvent.includes('UPDATE')) bits += 16;
    if (normalizedEvent.includes('DELETE')) bits += 8;
    if (normalizedEvent.includes('TRUNCATE')) bits += 32;
    sourceTriggers.set(name, { table, functionName, event: normalizedEvent, granularity, bits });
  }
}
assert.equal(sourceTriggers.size, 6, 'expected six source triggers');
const triggerSection = sectionBetween(sql, '-- SECTION: TRIGGERS', '-- SECTION: BACKFILLS');
const triggerReferenceBlock = sectionBetween(
  triggerSection,
  '-- The following are literal source-review references only.',
  '-- Read-only preflight: A13.',
);
assert.equal(
  (triggerReferenceBlock.match(/^\s*-- CREATE TRIGGER /gm) ?? []).length,
  6,
  'all six literal trigger references must remain SQL comments',
);
const uncommentedReferences = triggerReferenceBlock
  .split('\n')
  .map((line) => line.replace(/^\s*-- ?/, ''))
  .filter((line) => line.trim())
  .join('\n');
const literalTriggerPattern =
  /CREATE TRIGGER\s+"([^"]+)"\s+BEFORE\s+([\s\S]*?)\s+ON\s+"([^"]+)"\s+FOR EACH (ROW|STATEMENT)\s+EXECUTE FUNCTION\s+"([^"]+)"\(\);/g;
const literalTriggers = new Map();
for (const match of uncommentedReferences.matchAll(literalTriggerPattern)) {
  const [, name, event, table, granularity, functionName] = match;
  literalTriggers.set(name, {
    table,
    functionName,
    event: event.trim().replace(/\s+/g, ' '),
    granularity,
  });
}
assert.equal(literalTriggers.size, 6, 'expected six fully expanded literal trigger references');
for (const [name, source] of sourceTriggers) {
  const literal = literalTriggers.get(name);
  assert(literal, `literal source-review trigger missing: ${name}`);
  assert.equal(literal.table, source.table, `${name}: literal table drift`);
  assert.equal(literal.functionName, source.functionName, `${name}: literal function drift`);
  assert.equal(literal.event, source.event, `${name}: literal event drift`);
  assert.equal(literal.granularity, source.granularity, `${name}: literal granularity drift`);
}
const installedTriggers = new Map();
const specPattern = /\('([^']+)','([^']+)',(\d+),'([^']+)','([^']+)'\)/g;
for (const match of triggerSection.matchAll(specPattern)) {
  const [, name, table, bits, functionName, createKind] = match;
  installedTriggers.set(name, { table, bits: Number(bits), functionName, createKind });
}
assert.equal(installedTriggers.size, 6, 'trigger installer must enumerate exactly six triggers');
for (const [name, source] of sourceTriggers) {
  const installed = installedTriggers.get(name);
  assert(installed, `source trigger missing from installer: ${name}`);
  assert.equal(installed.table, source.table, `${name}: table drift`);
  assert.equal(installed.functionName, source.functionName, `${name}: function drift`);
  assert.equal(installed.bits, source.bits, `${name}: event/granularity drift`);
  const expectedKind =
    source.event === 'TRUNCATE' ? 'STATEMENT_TRUNCATE' :
      source.event === 'UPDATE' ? 'ROW_UPDATE' : 'ROW_UPDATE_DELETE';
  assert.equal(installed.createKind, expectedKind, `${name}: CREATE TRIGGER branch drift`);
}
assert(triggerSection.includes('BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT'));
assert(triggerSection.includes('BEFORE UPDATE ON public.%I FOR EACH ROW'));
assert(triggerSection.includes('BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW'));
assert(!/^\s*DROP\s+TRIGGER/im.test(triggerSection), 'trigger installer must not drop triggers');

// Lightweight scanner: query_to_xml's third argument is tableforest. All
// queries use tableforest=false so /table XPath roots remain present.
function parseCallArgs(text, openIndex) {
  const args = [];
  let start = openIndex + 1;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === "'" && text[i + 1] === "'") {
          i += 1;
        } else if (text[i] === "'") {
          break;
        }
      }
      continue;
    }
    if (ch === '"') {
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === '"' && text[i + 1] === '"') {
          i += 1;
        } else if (text[i] === '"') {
          break;
        }
      }
      continue;
    }
    if (ch === '$') {
      const tag = text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        const close = text.indexOf(tag, i + tag.length);
        assert(close >= 0, 'unterminated dollar-quoted SQL string');
        i = close + tag.length - 1;
        continue;
      }
    }
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      if (depth === 0) {
        args.push(text.slice(start, i).trim());
        return args;
      }
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  fail('unterminated query_to_xml call');
}
const xmlCalls = [];
for (let pos = sql.indexOf('query_to_xml('); pos >= 0; pos = sql.indexOf('query_to_xml(', pos + 1)) {
  xmlCalls.push(parseCallArgs(sql, pos + 'query_to_xml'.length));
}
assert(xmlCalls.length > 0, 'package should use guarded query_to_xml reads');
for (const args of xmlCalls) {
  assert.equal(args.length, 4, 'query_to_xml arity drift');
  assert.equal(args[1], 'false', 'query_to_xml NULL flag must remain false');
  assert.equal(args[2], 'false', 'query_to_xml tableforest must remain false');
}
assert(!/query_to_xml[\s\S]{0,500}?false\s*,\s*true/.test(sql), 'tableforest=true is incompatible with table-root XPath');
assert(sql.includes("IS NULL\n       THEN 'STOP_AND_REVIEW_DEVICE_COUNT_UNAVAILABLE'"), 'unavailable device count must not be treated as zero');
assert(sql.includes('A NULL exact_row_count is not zero'));

// Finance preflight, pre-mutation guard and before-COMMIT invariant.
const finance = sectionBetween(sql, '-- K. Receipt metadata. Source:', '-- SECTION: POSTFLIGHT READ ONLY');
assert(finance.includes('invalid_snapshot_shapes'));
assert(finance.includes("r.snapshot IS NULL"));
assert(finance.includes("jsonb_typeof(r.snapshot) IS DISTINCT FROM 'object'"));
assert(finance.includes("jsonb_typeof(r.snapshot->'invoiceId') IS DISTINCT FROM 'number'"));
assert(finance.includes("jsonb_typeof(r.snapshot->'schoolId') IS DISTINCT FROM 'number'"));
const firstReceiptMutation = finance.indexOf("EXECUTE 'UPDATE public.fee_receipts");
assert(firstReceiptMutation > 0);
const preMutationGuard = finance.slice(0, firstReceiptMutation);
assert(preMutationGuard.includes('r.snapshot IS NULL'));
assert(preMutationGuard.includes("jsonb_typeof(r.snapshot) IS DISTINCT FROM 'object'"));
assert(finance.includes('post-update receipt metadata invariant failed'));
assert(finance.indexOf('post-update receipt metadata invariant failed') < finance.lastIndexOf('COMMIT;'));
assert(!/UPDATE\s+public\.fee_payments/i.test(finance), 'payment verification evidence must never be overwritten');
const postflight = sectionBetween(sql, '-- SECTION: POSTFLIGHT READ ONLY');
assert(postflight.includes("jsonb_typeof(r.snapshot) IS DISTINCT FROM 'object'"));
assert(postflight.includes('invalid_snapshot_shapes'));

// Guardian eligibility allows all nonempty normalized phone digit strings.
assert(!/>=\s*7|at least seven|seven normalized digits/i.test(sql + report), 'invented phone-length policy found');
for (const required of [
  "nullif(btrim(st.parent_name),'') IS NOT NULL",
  "nullif(btrim(p.name),'') IS NOT NULL",
  "nullif(regexp_replace(st.parent_phone,'\\D','','g'),'') IS NOT NULL",
  "nullif(regexp_replace(p.phone,'\\D','','g'),'') IS NOT NULL",
]) {
  assert(sql.includes(required), `guardian nonempty normalization guard missing: ${required}`);
}

// Transactions, section labels/gates, and prohibited destructive operations.
const expectedLabels = [
  'PREFLIGHT READ ONLY',
  'STRUCTURAL DO NOT EXECUTE HERE (REFERENCE ONLY)',
  'FUNCTIONS',
  'TRIGGERS',
  'BACKFILLS',
  'POSTFLIGHT READ ONLY',
];
for (const label of expectedLabels) assert(sql.includes('-- SECTION: ' + label), `missing SQL section label: ${label}`);
const beginCount = (sql.match(/^BEGIN;$/gm) ?? []).length;
const commitCount = (sql.match(/^COMMIT;$/gm) ?? []).length;
assert.equal(beginCount, 8, 'explicit mutation transaction count drift');
assert.equal(commitCount, beginCount, 'unbalanced explicit COMMIT boundaries');
const gateValues = [
  'FUNCTIONS-APPROVED',
  'TRIGGERS-APPROVED',
  'GUARDIAN-BACKFILL-APPROVED',
  'LEGACY-SESSION-BACKFILL-APPROVED',
  'CLASS-HISTORY-BACKFILL-APPROVED',
  'COMMISSION-SEED-APPROVED',
  'DEVICE-BINDINGS-APPROVED',
  'FINANCE-METADATA-APPROVED',
];
for (const gate of gateValues) {
  const full = 'PRODUCTION-2026-10-01-' + gate;
  assert(sql.includes(full), `missing mutation gate ${full}`);
  assert(sql.includes("IS DISTINCT FROM '" + full + "'"), `gate not enforced in SQL ${full}`);
}
assert(sql.includes('PACKAGE-MODE: MANUAL_SECTION_SELECTION_ONLY; NEVER RUN THIS FILE AS A WHOLE.'));
assert(!/^\s*DROP\b/im.test(sql), 'prohibited DROP statement found');
assert(!/^\s*TRUNCATE\b/im.test(sql), 'prohibited standalone TRUNCATE statement found');
assert(!/^\s*ALTER\s+TABLE\b/im.test(sql), 'unexpected ALTER TABLE statement found');
assert(!/\bDELETE\s+FROM\b/i.test(sql), 'unexpected DELETE statement found');
assert(
  !/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE(?:\s+TABLE)?)\s+(?:[A-Za-z_][A-Za-z0-9_$]*\.)?(?:"?(?:__drizzle_migrations|drizzle_migrations|migration_journal|schema_migrations|_journal)"?)\b/i.test(sql),
  'migration ledger/journal mutation found',
);
const migrationTreeStatus = execFileSync('git', ['status', '--porcelain', '--', 'lib/db/drizzle'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
assert.equal(migrationTreeStatus.trim(), '', 'migration sources or migration journal/ledger files are modified');

// The single report embeds exact, section-specific executable SQL copies.
const reportEmbeds = {
  A: ['-- SECTION: PREFLIGHT READ ONLY', '-- SECTION: STRUCTURAL DO NOT EXECUTE HERE (REFERENCE ONLY)'],
  D: ['-- SECTION: FUNCTIONS', '-- SECTION: TRIGGERS'],
  E: ['-- SECTION: TRIGGERS', '-- SECTION: BACKFILLS'],
  F: ['-- F. Guardian/student links', '-- G. LEGACY academic sessions'],
  G: ['-- G. LEGACY academic sessions', '-- H. Historical class assignments'],
  H: ['-- H. Historical class assignments', '-- I. Commission seed.'],
  I: ['-- I. Commission seed.', '-- J. Device-school binding history.'],
  J: ['-- J. Device-school binding history.', '-- K. Receipt metadata.'],
  K: ['-- K. Receipt metadata. Source:', '-- SECTION: POSTFLIGHT READ ONLY'],
  M: ['-- SECTION: POSTFLIGHT READ ONLY', null],
};
const reportHeadings = {
  A: 'A. Production preflight checks',
  D: 'D. Exact function SQL',
  E: 'E. Exact trigger SQL',
  F: 'F. Guardian-link backfill SQL',
  G: 'G. LEGACY-session SQL',
  H: 'H. Historical class-assignment SQL',
  I: 'I. Commission seed SQL',
  J: 'J. Device/history backfill logic',
  K: 'K. Finance receipt/payment metadata logic',
  M: 'M. Postflight validation SQL',
};
for (const [label, [start, end]] of Object.entries(reportEmbeds)) {
  const expected = sectionBetween(sql, start, end);
  const beginMarker = '<!-- SQL-EMBED-BEGIN:' + label + ' -->';
  const endMarker = '<!-- SQL-EMBED-END:' + label + ' -->';
  const pattern = new RegExp(
    '<!-- SQL-EMBED-BEGIN:' + label + ' -->\\s*```sql\\n([\\s\\S]*?)\\n```\\s*<!-- SQL-EMBED-END:' + label + ' -->',
    'g',
  );
  const matches = [...report.matchAll(pattern)];
  assert.equal(matches.length, 1, `report must have exactly one SQL embed for ${label}`);
  assert.equal(matches[0][1].trimEnd(), expected, `report SQL embed ${label} differs from package SQL`);
  const headingPos = report.indexOf('## ' + reportHeadings[label] + '\n');
  assert(headingPos >= 0 && headingPos < report.indexOf(beginMarker), `embed ${label} is not under its report heading`);
  const nextHeading = report.indexOf('\n## ', headingPos + 4);
  assert(nextHeading < 0 || report.indexOf(endMarker) < nextHeading, `embed ${label} crosses its report heading`);
}

// Main-agent metadata/recovery and no-execution conclusions remain present.
assert(report.includes('https://edu-pulse-school-management--ogunlakinyemi.replit.app'));
assert(report.includes('database binding to the inspected Production resource is not'));
assert(report.includes('no project-specific recovery point/window'));
assert(report.includes('**Nothing in this package was executed against Production or Development.**'));
assert(!/pending main-agent completion|required by main agent to complete B\/C\/O/i.test(report));

console.log(JSON.stringify({
  status: 'offline validation passed',
  functionBodies: functionSources.length,
  sourceTriggers: sourceTriggers.size,
  queryToXmlCalls: xmlCalls.length,
  explicitTransactions: beginCount,
  reportSqlEmbeds: Object.keys(reportEmbeds).length,
  destructiveOrLedgerMutations: 0,
  migrationAndJournalFilesChanged: false,
  externalAccess: false,
}, null, 2));