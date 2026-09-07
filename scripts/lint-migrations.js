#!/usr/bin/env node

/**
 * Guards against the two mistakes that expose data through Supabase's auto-generated API:
 *
 *   1. A view created without `security_invoker=true` runs as its owner and
 *      ignores the RLS on the tables underneath it. Supabase grants SELECT on
 *      new views to anon automatically, so such a view is world-readable.
 *   2. Granting EXECUTE on a SECURITY DEFINER function to anon/authenticated
 *      publishes it at /rest/v1/rpc/<name>, RLS bypassed.
 *
 * Add `-- lint-ok: <reason>` on the line before a statement to allow it.
 *
 *   npm run migrations:lint
 */

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '../supabase/migrations');
const problems = [];

for (const name of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  const lines = fs.readFileSync(path.join(migrationsDir, name), 'utf8').split('\n');

  lines.forEach((line, i) => {
    const stripped = line.replace(/--.*$/, '');
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

    if (/\bGRANT\s+EXECUTE\b/i.test(stripped) && /\b(anon|authenticated|PUBLIC)\b/i.test(stripped)) {
      problems.push(
        `${name}:${i + 1}  EXECUTE granted to a public role\n` +
        `    ${line.trim()}\n` +
        `    Publishes the function at /rest/v1/rpc/. If that is intended, put\n` +
        `    "-- lint-ok: <reason>" on the line above and confirm it is not SECURITY DEFINER.`
      );
    }
  });
}

if (problems.length > 0) {
  console.error(`❌ ${problems.length} problem(s) in supabase/migrations:\n`);
  problems.forEach((p) => console.error(`  ${p}\n`));
  process.exit(1);
}

console.log('✅ No unsafe views or public EXECUTE grants in supabase/migrations');
