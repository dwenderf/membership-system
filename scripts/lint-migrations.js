#!/usr/bin/env node

/**
 * Guards against the mistakes that expose data -- or break access -- through
 * Supabase's auto-generated API:
 *
 *   1. A view created without `security_invoker=true` runs as its owner and
 *      ignores the RLS on the tables underneath it, so it can be world-readable.
 *   2. Granting EXECUTE on a SECURITY DEFINER function to anon/authenticated
 *      publishes it at /rest/v1/rpc/<name>, RLS bypassed. `GRANT ALL
 *      [PRIVILEGES] ON FUNCTION(S) / ALL FUNCTIONS IN SCHEMA ...` includes
 *      EXECUTE and is flagged the same way.
 *   3. A table, view or sequence created in `public` without a GRANT. Since
 *      2026-10-30 Supabase no longer grants anon / authenticated / service_role
 *      anything on new objects, so such an object answers 42501 "permission
 *      denied" before RLS runs -- in production and on every rebuild from
 *      migrations. The GRANT belongs in the same migration as the CREATE, next
 *      to ENABLE ROW LEVEL SECURITY and the policies, and should be the
 *      minimum the object's access path needs (see AGENTS.md).
 *
 * One more check is a WARNING, not a failure (exit code unchanged):
 *   4. A GRANT of TRUNCATE, REFERENCES, TRIGGER, MAINTAIN (or ALL) on a table or
 *      view to anon / authenticated / PUBLIC, in a migration newer than
 *      20261102180000_revoke_truncate_references_trigger_from_api_roles.sql.
 *      This includes ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES. RLS does
 *      not gate those privileges and PostgREST never uses them, so the API
 *      roles do not need them. (service_role is not checked.)
 *
 * Add `-- lint-ok: <reason>` on the line before a statement to allow it.
 *
 *   npm run migrations:lint
 */

const fs = require('fs');
const path = require('path');

/**
 * Migrations that sort before this one were written when Supabase still
 * granted new objects automatically, so they carry no GRANTs; this file
 * grants all of them in one place. Older files may satisfy rule 3 from it.
 * Every newer migration must carry its own GRANTs.
 */
const LEGACY_GRANT_MIGRATION = '20261102170500_explicit_public_grants.sql';

/**
 * 20261102180000 revoked TRUNCATE / REFERENCES / TRIGGER / MAINTAIN from anon
 * and authenticated, and from the postgres default ACL for tables. Migrations
 * newer than it get a warning if they grant any of them (or ALL) on a table or
 * view, or by default privileges on tables, to those roles again.
 */
const NARROWING_MIGRATION = '20261102180000_revoke_truncate_references_trigger_from_api_roles.sql';

const IDENT = '(?:"[^"]+"|[A-Za-z_][\\w$]*)';
const QUALIFIED = `(?:${IDENT}\\.)?${IDENT}`;

/** `public.foo`, `"public"."foo"` or bare `foo` -> `foo`; other schemas -> null. */
function publicName(raw) {
  const parts = raw.split('.').map((p) => p.trim().replace(/^"|"$/g, '').toLowerCase());
  if (parts.length === 2 && parts[0] !== 'public') return null;
  return parts[parts.length - 1];
}

/** Blank out comments and string literals, keeping offsets (and line numbers) intact. */
function blank(sql) {
  const keep = (s) => s.replace(/[^\n]/g, ' ');
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, keep)
    .replace(/--[^\n]*/g, keep)
    .replace(/'(?:[^']|'')*'/g, keep);
}

/** Roles whose access a new object has to be opened to; a grant to anyone else does not count. */
const API_ROLE = /(?:^|[\s,])"?(?:anon|authenticated|service_role)"?(?=$|[\s,])/i;

/**
 * Relation names named by GRANT ... ON [TABLE|SEQUENCE] a, b TO <roles> statements,
 * where <roles> includes at least one of anon / authenticated / service_role
 * (a grant to postgres or PUBLIC alone does not open an object to the API).
 */
function grantedRelations(sql) {
  const granted = new Set();
  const re = new RegExp(
    `\\bGRANT\\b[^;]*?\\bON\\s+(?:TABLE\\s+|SEQUENCE\\s+)?(${QUALIFIED}(?:\\s*,\\s*${QUALIFIED})*)\\s+TO\\b([^;]*)`,
    'gi'
  );
  let m;
  while ((m = re.exec(sql)) !== null) {
    if (/^\s*(?:ALL|FUNCTION|SCHEMA|DATABASE|ROUTINE|PROCEDURE)\b/i.test(m[1])) continue;
    if (!API_ROLE.test(m[2].replace(/\bWITH\s+GRANT\s+OPTION\b/gi, ''))) continue;
    for (const name of m[1].split(',')) {
      const n = publicName(name.trim());
      if (n) granted.add(n);
    }
  }
  return granted;
}

function lineOf(sql, offset) {
  return sql.slice(0, offset).split('\n').length;
}

function lintMigrations(migrationsDir, legacyGrantMigration = LEGACY_GRANT_MIGRATION) {
  const problems = [];
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const raw = {};
  const grants = {};
  for (const name of files) {
    raw[name] = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
    grants[name] = grantedRelations(blank(raw[name]));
  }

  // Relations created by an earlier file. Re-creating one (CREATE OR REPLACE
  // VIEW, CREATE ... IF NOT EXISTS) keeps its privileges, so it needs no GRANT
  // of its own -- unless the file drops it first, which wipes them.
  const known = new Set();
  const dropRe = new RegExp(
    `\\bDROP\\s+(?:MATERIALIZED\\s+)?(?:TABLE|VIEW|SEQUENCE)\\s+(?:IF\\s+EXISTS\\s+)?(${QUALIFIED}(?:\\s*,\\s*${QUALIFIED})*)`,
    'gi'
  );

  for (const name of files) {
    const lines = raw[name].split('\n');
    const blanked = blank(raw[name]);
    const blankedLines = blanked.split('\n');
    let d;
    while ((d = dropRe.exec(blanked)) !== null) {
      for (const n of d[1].split(',')) {
        const rel = publicName(n.trim());
        if (rel) known.delete(rel);
      }
    }

    lines.forEach((line, i) => {
      const stripped = blankedLines[i];
      const allowed = i > 0 && /--\s*lint-ok:/i.test(lines[i - 1]);
      if (allowed) return;

      if (/\bCREATE\s+(OR\s+REPLACE\s+)?(TEMP\s+|TEMPORARY\s+)?(RECURSIVE\s+)?VIEW\b/i.test(stripped) &&
          !/security_invoker\s*=\s*true/i.test(stripped)) {
        problems.push(
          `${name}:${i + 1}  view created without security_invoker=true\n` +
          `    ${line.trim()}\n` +
          `    Add WITH (security_invoker=true) so the view respects the caller's RLS.`
        );
      }
    });

    // Rule 2: GRANT EXECUTE (or GRANT ALL on functions / procedures / routines,
    // which includes EXECUTE) to anon / authenticated / PUBLIC. Only the grantee
    // list (the text after the last TO of the statement) is inspected, so a
    // `public.` schema qualifier, or a function named after one of the roles,
    // elsewhere in the statement does not trip it. Works across lines.
    const execRe = /\bGRANT\s+(?:EXECUTE\b|ALL(?:\s+PRIVILEGES)?\s+ON\s+(?:ALL\s+)?(?:FUNCTIONS?|PROCEDURES?|ROUTINES?)\b)[^;]*/gi;
    let e;
    while ((e = execRe.exec(blanked)) !== null) {
      const afterTo = e[0].split(/\bTO\b/i);
      if (afterTo.length < 2) continue;
      const grantees = afterTo[afterTo.length - 1].replace(/\bWITH\s+GRANT\s+OPTION\b/gi, '');
      if (!/(?:^|[\s,])"?(?:anon|authenticated|PUBLIC)"?(?=$|[\s,])/i.test(grantees)) continue;
      const line = lineOf(blanked, e.index);
      if (line > 1 && /--\s*lint-ok:/i.test(lines[line - 2])) continue;
      problems.push(
        `${name}:${line}  EXECUTE granted to a public role\n` +
        `    ${lines[line - 1].trim()}\n` +
        `    Publishes the function at /rest/v1/rpc/. If that is intended, put\n` +
        `    "-- lint-ok: <reason>" on the line above and confirm it is not SECURITY DEFINER.`
      );
    }

    // Rule 3: every CREATE TABLE / VIEW / SEQUENCE in public needs a GRANT.
    // Matching view creation is done on the blanked text so a CREATE VIEW in a
    // comment or string is ignored; the lint-ok escape is read from the raw lines.
    const sql = blanked;
    const createRe = new RegExp(
      `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:UNLOGGED\\s+)?(?:(?:RECURSIVE\\s+)?(?:MATERIALIZED\\s+)?(TABLE|VIEW|SEQUENCE))\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})`,
      'gi'
    );
    const seen = new Set();
    let m;
    while ((m = createRe.exec(sql)) !== null) {
      const kind = m[1].toUpperCase();
      const rel = publicName(m[2]);
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      const alreadyThere = known.has(rel);
      known.add(rel);
      if (alreadyThere) continue;
      const line = lineOf(sql, m.index);
      if (line > 1 && /--\s*lint-ok:/i.test(lines[line - 2])) continue;

      const inFile = grants[name].has(rel);
      const inLegacy =
        legacyGrantMigration &&
        name < legacyGrantMigration &&
        grants[legacyGrantMigration] &&
        grants[legacyGrantMigration].has(rel);
      if (inFile || inLegacy) continue;

      const verb = kind === 'SEQUENCE' ? 'USAGE, SELECT' : kind === 'VIEW' ? 'SELECT' : 'SELECT, INSERT, UPDATE, DELETE';
      problems.push(
        `${name}:${line}  ${kind.toLowerCase()} public.${rel} created without a GRANT\n` +
        `    ${lines[line - 1].trim()}\n` +
        `    Supabase no longer grants new objects to anon/authenticated/service_role, so\n` +
        `    access fails with 42501 before RLS runs. In this migration add the minimum the\n` +
        `    access path needs, e.g.  GRANT ${verb} ON public.${rel} TO service_role;\n` +
        `    (add authenticated/anon only if the browser client reads it). If it is truly\n` +
        `    unreachable by every API role, put "-- lint-ok: <reason>" on the line above.`
      );
    }
  }

  return problems;
}

/**
 * Warnings (non-fatal): GRANT TRUNCATE / REFERENCES / TRIGGER / MAINTAIN / ALL
 * on a table or view (or ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES) to anon, authenticated or PUBLIC, in a migration newer than the one
 * that revoked them. Sequences, functions, schemas and databases are skipped
 * (ALL PRIVILEGES there does not include the three), as is a REVOKE.
 */
function lintMigrationWarnings(migrationsDir, narrowingMigration = NARROWING_MIGRATION) {
  const warnings = [];
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const grantRe = /\bGRANT\b([^;]*?)\bON\b([^;]*?)\bTO\b([^;]*)/gi;
  for (const name of files) {
    if (!(name > narrowingMigration)) continue;
    const text = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
    const lines = text.split('\n');
    const blanked = blank(text);
    let m;
    grantRe.lastIndex = 0;
    while ((m = grantRe.exec(blanked)) !== null) {
      const [, privs, target, grantees] = m;
      if (!/\b(?:TRUNCATE|REFERENCES|TRIGGER|MAINTAIN|ALL)\b/i.test(privs)) continue;
      if (/^\s*(?:(?:ALL\s+)?(?:SEQUENCES|FUNCTIONS|ROUTINES|PROCEDURES)\b|SEQUENCE\b|FUNCTION\b|ROUTINE\b|PROCEDURE\b|SCHEMA\b|DATABASE\b|DOMAIN\b|LANGUAGE\b|TYPE\b|TABLESPACE\b|LARGE\b|FOREIGN\b|PARAMETER\b)/i.test(target)) continue;
      const toList = grantees.replace(/\bWITH\s+GRANT\s+OPTION\b/gi, '');
      if (!/(?:^|[\s,])"?(?:anon|authenticated|PUBLIC)"?(?=$|[\s,])/i.test(toList)) continue;
      const line = lineOf(blanked, m.index);
      if (line > 1 && /--\s*lint-ok:/i.test(lines[line - 2])) continue;
      warnings.push(
        `${name}:${line}  TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (or ALL) granted to anon/authenticated/PUBLIC\n` +
        `    ${lines[line - 1].trim()}\n` +
        `    RLS does not gate these privileges and PostgREST never uses them; they were revoked\n` +
        `    from the API roles (and from the default ACL) by ${narrowingMigration}.\n` +
        `    Grant only the DML verbs the access path needs (SELECT, INSERT, UPDATE, DELETE), or put\n` +
        `    "-- lint-ok: <reason>" on the line above.`
      );
    }
  }
  return warnings;
}

module.exports = { lintMigrations, lintMigrationWarnings, grantedRelations, LEGACY_GRANT_MIGRATION, NARROWING_MIGRATION };

if (require.main === module) {
  const migrationsDir = path.join(__dirname, '../supabase/migrations');
  const problems = lintMigrations(migrationsDir);
  const warnings = lintMigrationWarnings(migrationsDir);

  if (warnings.length > 0) {
    console.warn(`⚠️  ${warnings.length} warning(s) in supabase/migrations (not blocking):\n`);
    warnings.forEach((w) => console.warn(`  ${w}\n`));
    if (process.env.GITHUB_ACTIONS) {
      warnings.forEach((w) => {
        const [head] = w.split('\n');
        const [loc, ...rest] = head.split(/\s{2,}/);
        const [file, ln] = loc.split(':');
        console.log(`::warning file=supabase/migrations/${file},line=${ln}::${rest.join(' ')}`);
      });
    }
  }

  if (problems.length > 0) {
    console.error(`❌ ${problems.length} problem(s) in supabase/migrations:\n`);
    problems.forEach((p) => console.error(`  ${p}\n`));
    process.exit(1);
  }

  console.log('✅ No unsafe views, public EXECUTE grants or ungranted tables/views/sequences in supabase/migrations');
}
