# Agent Instructions

Instructions for AI coding agents working in this repository.

## Testing the UI

The login screen (magic link/OTP, Google OAuth, passkey) can't be driven by automated tools. On preview deployments, use the login bypass endpoint instead of trying to automate the real login flow — see [README.md § Preview auth bypass for automated testing](README.md#preview-auth-bypass-for-automated-testing) for the endpoint, required env vars, and one-time setup.

## Environment variables

This repo is linked to Vercel (`nycpha/membership-system`). A fresh git worktree has no `.env.local` and no `.vercel/` link, so set both up rather than copying a `.env.local` from elsewhere (different checkouts can point at different Supabase projects, and a stale copy silently drifts from what's actually configured):

1. Link the worktree: copy `.vercel/project.json` from an already-linked checkout in this repo (it's just a project ID + org ID, not a secret), or run `vercel link` if none exists.
2. Pull real values: `vercel env pull .env.local`. This targets the `development` environment by default — a var scoped only to `Preview` in the Vercel dashboard won't come through. If a build fails on a var that's missing from `development`, don't assume it's absent from Vercel entirely; check its environment scope in the dashboard, or retry with `vercel env pull .env.local --environment=preview` if directed to do so.
3. Install dependencies: a fresh worktree has no `node_modules` either — run `npm install` before `npm run dev` / `npm run build` if you haven't already in this worktree. Skipping this looks like a config problem (`sh: next: command not found`, exit code 127) rather than a missing-install-step problem, especially right after troubleshooting env vars in the same session.

**This assumes an already-authenticated `vercel` CLI.** A fresh Claude Code on the web / other cloud session has no cached login (`~/.vercel/auth.json`) and no `VERCEL_TOKEN`, and `vercel login`'s OAuth flow needs an interactive browser the sandbox doesn't have — so steps 1–2 above silently aren't available there, even though they work fine in a local session. If a maintainer has just added you to the shared Vercel team, accepting the email invite alone isn't enough for the CLI to see it — `vercel teams ls` will keep showing only your personal team until you run `vercel logout` then `vercel login` again to refresh the session. Enabling the Vercel MCP connector doesn't substitute for this: it manages projects/deployments/logs but has no tool for reading environment variable values. If you're stuck this way and need `npm run build`/tests to get past a missing var, don't fabricate real credentials or claim a build validated real integrations — either ask the user to run `vercel env pull` locally and share the resulting `.env.local`, or use placeholder values (e.g. `XERO_CLIENT_ID=placeholder`) purely to satisfy module-level `if (!process.env.X) throw` guards, and say explicitly that this only verifies compilation, not behavior against real services.

`.env.example` is the source of truth for which env vars the app expects. When you add code that reads a new `process.env.X`, add `X=` (key only, never a real value) to `.env.example` in the same change.

Deploy previews through the shared `nycpha/membership-system` Vercel project. If you connect a personal/sandbox Vercel project instead, read [README.md § Setting up a personal Vercel project for preview deploys](README.md#setting-up-a-personal-vercel-project-for-preview-deploys) first — bulk env-var imports and `vercel.json`'s cron schedules both have non-obvious failure modes there. Never edit `vercel.json` to make a deploy succeed; the scheduled jobs are triggerable from the admin UI instead.

## Database migrations

Migrations are applied manually by the maintainer. Write the migration file only. Do not run `supabase db push`, `db reset`, `migration up`, or `supabase link` under any circumstances. Do not attempt to verify the migration by connecting to the database. The migration file existing in `supabase/migrations/` is the complete deliverable.

Name migrations the way the Supabase CLI expects: `YYYYMMDDHHMMSS_descriptive_name.sql`, timestamped in UTC. The old `YYYY-MM-DD-name.sql` style is silently skipped by `supabase db push` and `supabase migration list`, which then report "up to date" against a database nothing has been applied to.

Write migrations idempotently where possible (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP ... IF EXISTS`, etc.) so a migration can be safely re-applied without erroring if it was already partially or fully applied.

After adding a migration, run `npm run schema:build` and commit the regenerated `supabase/schema.sql` in the same change. Then run `npm run schema:verify`, which applies `schema.sql` twice to a throwaway database and checks that every table has RLS and every view is `security_invoker` (it needs a reachable PostgreSQL server via the standard `PG*` env vars; CI runs it against a service container). Parsing SQL is not enough to catch a bad migration — `COMMENT ON TABLE <a view>` parses fine and fails on execution. That file is generated (the migrations concatenated in filename order), never hand-edited; `npm run schema:check` fails when the two are out of sync. `supabase/migrations/20260907000000_baseline_schema.sql` is a snapshot of the production database taken on 2026-09-07 that replaced the 140 dated migration files preceding it — read it, not the git history, for the current shape of the schema.

## Views and functions are public API

Supabase publishes everything in the `public` schema through PostgREST, so a new view or function is reachable from the internet with the (public) anon key the moment it exists. Two rules, both enforced by `npm run migrations:lint` (a blocking CI step):

- **Every view must be created `WITH (security_invoker=true)`.** Without it a view runs as its owner and ignores RLS on the tables underneath, while Supabase's default privileges hand `anon` SELECT on it automatically. All nine existing views set this.
- **Never `GRANT EXECUTE ... TO anon`/`authenticated`/`PUBLIC` without a stated reason.** As of `20260907000002_revoke_public_function_access.sql`, new functions in `public` are no longer granted to those roles by default, so a function is unreachable over `/rest/v1/rpc/` unless a migration grants it explicitly. If a function is only called server-side (every `.rpc()` call in this repo uses `createAdminClient`), it needs no grant at all — `service_role` is unaffected.

`SECURITY DEFINER` deserves particular care: such a function ignores RLS entirely, so combining it with a public grant exposes whatever it selects. Three ad-hoc export functions reached production that way and returned every member's name, email and member_id to unauthenticated callers.

When an external consumer (a spreadsheet, a dashboard) needs data, the answer is an authenticated API route, never a view or function — see [README § Exposing Data to External Consumers](README.md#exposing-data-to-external-consumers) and `src/app/api/admin/exports/members/route.ts` for the reference implementation.

## Supabase relation queries

The Supabase clients in `src/lib/supabase/` (`createServerClient`/`createBrowserClient`/`createClient`) don't pass the generated `Database` type as a generic, so it defaults to `any` — `.select()` results, including embedded relations (joins), are not compiler-checked by default. When postgrest-js can't resolve real foreign-key cardinality from schema metadata, it silently infers **every** embedded relation as an array, even a true one-to-one "belongs-to" join. Don't trust the inferred type's array-ness as a signal of real cardinality, and don't blindly add `[0]` indexing or `Array.isArray()` handling to silence a type error without checking first.

Before writing access code for a joined relation, check the actual foreign key in `supabase/migrations/20260907000000_baseline_schema.sql` (its `FOREIGN KEYS` section lists every one, `table, constraint, definition`) or the generated `supabase/schema.sql`: a FK column defined on the table you're querying *from*, pointing at the joined table (`NOT NULL` or nullable), means that relation is single-object — write `.name` / `?.name` access, not array handling. A FK defined on the *other* table pointing back at you means it's genuinely one-to-many. Once cardinality is verified, declare it explicitly with `.overrideTypes<T, { merge: false }>()` (the current, non-deprecated replacement for the old `.returns<T>()`) on the query, so the compiler enforces the real shape instead of silently allowing `any`.

`src/types/database.ts` is a manually-maintained/generated snapshot that's known to drift from the live schema (for example, it's missing the `registration_categories` table entirely, and some FK relationships/columns added in later migrations aren't reflected). Don't treat it as authoritative for cardinality — check the migrations directly. When your change adds a new table/column that other code will read via a `Database[...]` annotation, update `database.ts` in the same change.

## Admin pages

When adding a new admin page, add it to navigation and verify it's reachable by clicking, not by URL.

## Loops email templates

When adding a new Loops transactional email template, prepend `{testEmailPrefix}` to the Subject field in the Loops dashboard (mark it optional as a safety net) — see [README.md § Email Integration Setup (Loops.so)](README.md#email-integration-setup-loopsso). The app already sends `testEmailPrefix` in `dataVariables` on every send (`[TEST] ` on preview/local, `''` in production — see [src/lib/email/environment.ts](src/lib/email/environment.ts)); no code changes are needed for a new template beyond the dashboard edit.

## Before reporting work complete

Run `npm run build` and paste the raw, unfiltered output — including the final success or error lines. Do not summarize, scope, or filter the result (e.g. "0 errors in modified files"). If the build fails, fix it and re-run; do not report completion with a failing build.

`npx tsc --noEmit` is a faster subset useful during iteration, but it is not a substitute: `npm run build` additionally parses pages and components that no test imports, runs lint, and validates server/client boundaries. `npm run build` type-checks too, and CI runs `npm run typecheck` (`tsc --noEmit`) as a blocking step, so type errors fail the build either way. Run `npx tsc --noEmit` during iteration anyway since it's faster than a full build.

If a bare `npx tsc --noEmit` aborts immediately with `TS2688 Cannot find type definition file for '<pkg> 2'` errors before checking any real source file, that's a stray macOS-sync duplicate-directory artifact in `node_modules/@types` (e.g. `babel__core 2`), not a real problem — work around it with `npx tsc --noEmit --typeRoots ./node_modules/@types`. `npm run build` is unaffected by this.

The same applies to test runs: paste the actual Jest output, not a description of it.

## Linting

`npm run lint` is a blocking CI step — a lint error fails the build, not just a warning. Run it before reporting work complete and fix anything it flags in files you touch.
