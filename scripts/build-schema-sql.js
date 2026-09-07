#!/usr/bin/env node

/**
 * Builds supabase/schema.sql from supabase/migrations/.
 *
 * schema.sql is a generated artifact: the migration files, concatenated in
 * filename order. Regenerating it after every migration is what keeps it from
 * drifting out of date the way it did before (issue #256).
 *
 *   npm run schema:build   rewrite supabase/schema.sql
 *   npm run schema:check   fail if supabase/schema.sql is out of date
 */

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '../supabase/migrations');
const schemaPath = path.join(__dirname, '../supabase/schema.sql');
const checkOnly = process.argv.includes('--check');

const migrations = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (migrations.length === 0) {
  console.error('❌ No migrations found in supabase/migrations');
  process.exit(1);
}

const header = [
  '-- =============================================================================',
  '-- GENERATED FILE -- DO NOT EDIT',
  '-- =============================================================================',
  '--',
  '-- Built from supabase/migrations/ by scripts/build-schema-sql.js.',
  '-- Run `npm run schema:build` after adding a migration.',
  '--',
  '-- Apply this file to bootstrap a fresh Supabase project; apply individual',
  '-- migrations to update an existing one.',
  '--',
  '-- Source files, in order:',
  ...migrations.map((name) => `--   ${name}`),
  '-- =============================================================================',
  '',
  '',
].join('\n');

const body = migrations
  .map((name) => {
    const contents = fs.readFileSync(path.join(migrationsDir, name), 'utf8').trimEnd();
    return `-- >>> ${name} >>>\n\n${contents}\n\n-- <<< ${name} <<<\n`;
  })
  .join('\n');

const generated = `${header}${body}`;

if (checkOnly) {
  const current = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : '';
  if (current !== generated) {
    console.error('❌ supabase/schema.sql is out of date. Run `npm run schema:build`.');
    process.exit(1);
  }
  console.log(`✅ supabase/schema.sql is up to date (${migrations.length} migration file(s))`);
  process.exit(0);
}

fs.writeFileSync(schemaPath, generated);
console.log(`✅ Wrote supabase/schema.sql from ${migrations.length} migration file(s)`);
