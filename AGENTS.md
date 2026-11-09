# Agent Instructions

Instructions for AI coding agents working in this repository.

## Testing the UI

The login screen (magic link/OTP, Google OAuth, passkey) can't be driven by automated tools. On preview deployments, use the login bypass endpoint instead of trying to automate the real login flow — see [README.md § Preview auth bypass for automated testing](README.md#preview-auth-bypass-for-automated-testing) for the endpoint, required env vars, and one-time setup.

## Environment variables

This repo is linked to Vercel (`nycpha/membership-system`). A fresh git worktree has no `.env.local` and no `.vercel/` link, so set both up rather than copying a `.env.local` from elsewhere (different checkouts can point at different Supabase projects, and a stale copy silently drifts from what's actually configured):

1. Link the worktree: copy `.vercel/project.json` from an already-linked checkout in this repo (it's just a project ID + org ID, not a secret), or run `vercel link` if none exists.
2. Pull real values: `vercel env pull .env.local`. This targets the `development` environment by default — a var scoped only to `Preview` in the Vercel dashboard won't come through. If a build fails on a var that's missing from `development`, don't assume it's absent from Vercel entirely; check its environment scope in the dashboard, or retry with `vercel env pull .env.local --environment=preview` if directed to do so.
3. Install dependencies: a fresh worktree has no `node_modules` either — run `nvm use` (the Node version is pinned in `.nvmrc`; `nvm install` if it isn't installed yet) and then `npm install` before `npm run dev` / `npm run build` if you haven't already in this worktree. Skipping this looks like a config problem (`sh: next: command not found`, exit code 127) rather than a missing-install-step problem, especially right after troubleshooting env vars in the same session. Each Bash call starts a fresh shell, so `nvm use` doesn't carry over between calls — prefix commands with `source ~/.nvm/nvm.sh && nvm use >/dev/null &&` when the Node version matters. Otherwise you're silently building and testing on whatever the machine's default Node is, not the version Vercel and CI use. npm 11 (bundled with Node 24) also blocks dependency install scripts unless they're listed in `allowScripts` in `package.json`; if a new dependency needs one, `npm install` ends with a "scripts not yet covered by allowScripts" warning, and `npm install-scripts approve --no-allow-scripts-pin <pkg>` adds it.

**This assumes an already-authenticated `vercel` CLI.** A fresh Claude Code on the web / other cloud session has no cached login (`~/.vercel/auth.json`) and no `VERCEL_TOKEN`, and `vercel login`'s OAuth flow needs an interactive browser the sandbox doesn't have — so steps 1–2 above silently aren't available there, even though they work fine in a local session. If a maintainer has just added you to the shared Vercel team, accepting the email invite alone isn't enough for the CLI to see it — `vercel teams ls` will keep showing only your personal team until you run `vercel logout` then `vercel login` again to refresh the session. Enabling the Vercel MCP connector doesn't substitute for this: it manages projects/deployments/logs but has no tool for reading environment variable values. If you're stuck this way and need `npm run build`/tests to get past a missing var, don't fabricate real credentials or claim a build validated real integrations — either ask the user to run `vercel env pull` locally and share the resulting `.env.local`, or use placeholder values (e.g. `XERO_CLIENT_ID=placeholder`) purely to satisfy module-level `if (!process.env.X) throw` guards, and say explicitly that this only verifies compilation, not behavior against real services.

`.env.example` is the source of truth for which env vars the app expects. When you add code that reads a new `process.env.X`, add `X=` (key only, never a real value) to `.env.example` in the same change.

Deploy previews through the shared `nycpha/membership-system` Vercel project. If you connect a personal/sandbox Vercel project instead, read [README.md § Setting up a personal Vercel project for preview deploys](README.md#setting-up-a-personal-vercel-project-for-preview-deploys) first — bulk env-var imports and `vercel.json`'s cron schedules both have non-obvious failure modes there. Never edit `vercel.json` to make a deploy succeed; the scheduled jobs are triggerable from the admin UI instead.

## Database migrations

`supabase/migrations/` is the schema's source of truth, and `supabase/schema.sql` is generated from it. Until 2026-09-07 every migration was applied by hand under filenames the Supabase CLI silently ignores, which is how dev and production drifted apart in both directions. That is fixed: files are CLI-named, `20260907000000_baseline_schema.sql` is a snapshot of production, and both projects' migration history is seeded, so `supabase db push` and `supabase migration list` now report the truth.

### What you may do

- **Write migration files.** This is the deliverable for a schema change, always.
- **Apply to the development project** (`membership-system-dev`, ref `qojixnzpfkpteakltdoa`), via the Supabase MCP `apply_migration` or the *Apply database migrations* workflow. Preview deployments run against that database, so a schema-dependent change cannot be exercised until the migration is on it. Apply before pushing the branch, then say in your summary what you applied.

  **If you used `apply_migration`, verify the version it recorded.** That tool stamps `supabase_migrations.schema_migrations.version` with the wall-clock time the call runs, not the filename's leading timestamp — so a migration named `20260908154524_foo.sql` can land in the table as version `20260908155024` or whatever moment the call happened to land on. `supabase db push` (what the *Apply database migrations* workflow runs on every push touching `supabase/migrations/`) treats that as a genuine mismatch and fails with "Remote migration versions not found in local migrations directory" the next time anything pushes to that branch — after the push has already landed, so nothing catches it before merge. Check immediately after applying:
  ```sql
  select version, name from supabase_migrations.schema_migrations order by version desc limit 1;
  ```
  If `version` doesn't match the filename's timestamp, fix it before pushing the branch — this only realigns the CLI's bookkeeping with the file already in the repo, it doesn't touch the schema:
  ```sql
  UPDATE supabase_migrations.schema_migrations SET version = '<filename-timestamp>' WHERE version = '<wrong-version>';
  ```

  If you *cannot* — no Supabase MCP in your session, no permission to run Actions workflows, or a fork PR where secrets are unavailable — then say so plainly in your summary and in the PR description, naming the file that still needs applying. Do not push a schema-dependent branch and let its preview fail without explanation; a missing column reads as a broken feature, and the next person debugs the wrong thing.
- **Run read-only queries against either project** — catalog inspection, drift comparison, `pg_stat_statements`, `get_advisors`, logs. Do this liberally; it is how the dev/prod drift and the anonymous data exposure were both found. Reading is not the same as changing.

### What you must not do

- **Never apply anything to production** (`membership-system-prod`, ref `fogsphzerhmyjckxhalj`). Not a migration, not a "quick fix", not a backfill. Hand the maintainer the SQL.
- **Never run `supabase db reset`**, or anything else that drops or recreates a database.
- **Never edit a migration file that has already been applied anywhere.** Write a new one; the CLI keys on the version, so an edited file is never re-run and the two databases quietly diverge.

### How production gets changed

By a human, deliberately, through the *Apply database migrations* workflow — which now applies immediately and unattended on push to `main`, with no approval step to wait for. That's new: the workflow used to pause on `main` for a required reviewer on the `production` GitHub Environment, once the push had already landed. That gate ran too late to matter — Vercel deploys the new application code immediately and unconditionally on push to `main`, independent of this workflow — so the old design left a real window (observed once at over five hours) where production served new code against old schema before anyone got around to approving. Neither Environment has a required reviewer now.

The human checkpoint moved *before* the merge instead of disappearing, and it's now an actual enforced block rather than a click someone could forget: **`Migration applied to target database`, a required PR check, fails a pull request outright if its target branch's database is missing a migration this repo carries.** A migration has to be applied (via *Apply database migrations*, manually, before merging) or the PR can't merge at all (#290). `.github/CODEOWNERS` additionally names a reviewer for `supabase/migrations/`, so a promotion PR carrying one also surfaces that in the Files Changed panel — a useful signal, but informational only, since GitHub never lets a PR author satisfy a required review on their own PR; the required *status check* is what actually blocks the merge on this single-maintainer repo, not the Code Owner review.

Do not suggest the SQL editor as a way to apply a migration: it runs the SQL without writing a row to `supabase_migrations.schema_migrations`, so the CLI still thinks the migration is pending and the next `db push` (or the preflight check above) reports the database as behind. If it is ever used, it has to be followed by `supabase migration repair --status applied <version>`. The apply workflow runs after the push has landed and cannot fail or undo a merge: a red run means the code is on the branch and the migration is not applied. Say in the PR description which file needs applying, so whoever picks it up knows what to run.

### Requirements for every migration

Name it the way the CLI expects: `YYYYMMDDHHMMSS_descriptive_name.sql`, timestamped in UTC. The old `YYYY-MM-DD-name.sql` style is silently skipped by `db push` and `migration list`, which then report "up to date" against a database nothing has been applied to.

**Make it re-runnable.** `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP ... IF EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`, and `ALTER TABLE ... ADD CONSTRAINT` wrapped in a `DO` block that checks `pg_constraint` first. `npm run schema:verify` applies the whole schema twice and fails if the second pass errors.

**Make it safe to apply early.** Every open preview shares the one development database, and the migration lands there before the code that needs it:

- New columns are nullable or have a default. Never `SET NOT NULL` without backfilling in the same file, and guard the backfill so it is a no-op on a database that has already run it.
- Do not drop or rename anything until the code referencing it is gone from `development`.
- Code that reads a new column deploys *after* the migration that adds it, never in the same breath.
- Anything destructive is conditional, and called out at the top of the file so a reviewer sees it without reading the SQL.

**Grant what you create.** Since 2026-10-30 Supabase no longer grants `anon`, `authenticated` or `service_role` anything on new tables, views or sequences in `public` ([announcement](https://github.com/orgs/supabase/discussions/45329)). Without an explicit `GRANT` the first query answers `42501 permission denied` — before RLS is consulted — on any project or rebuild that no longer applies the old default privileges (a fresh database from migrations does not; check the project's default-privileges / Data API settings before assuming a given live project has flipped). New functions need an explicit `GRANT EXECUTE ... TO service_role` too, and a `REVOKE ... FROM PUBLIC`. Every migration that creates one of them includes the `GRANT`, next to `ENABLE ROW LEVEL SECURITY` and the policies. See [Grants on new tables, views and sequences](#grants-on-new-tables-views-and-sequences). `npm run migrations:lint` fails the build when a `CREATE TABLE`/`VIEW`/`SEQUENCE` in `public` has no matching `GRANT`. Do not grant `TRUNCATE`, `REFERENCES`, `TRIGGER` or `MAINTAIN` to `anon`/`authenticated` (the lint warns).

**Watch for statements that parse but fail on execution.** A syntax check will not catch these:

- `COMMENT ON VIEW` for views — `COMMENT ON TABLE` against a view raises `42809`.
- `CREATE OR REPLACE VIEW` cannot rename, reorder or drop a column. If the shape changes, drop the dependents and recreate in dependency order.
- `CREATE OR REPLACE FUNCTION` cannot change a return type; drop it first.

### Before reporting a schema change complete

Run `npm run schema:build` and commit the regenerated `supabase/schema.sql` in the same change — it is generated (the migrations concatenated in filename order) and never hand-edited. Then `npm run schema:check`, `npm run migrations:lint`, and `npm run schema:verify` (needs a reachable PostgreSQL server via the standard `PG*` env vars; CI runs it against a service container). Read `20260907000000_baseline_schema.sql`, not the git history, for the current shape of the schema.

## Postgres version upgrades

Distinct from the schema migrations above: this is upgrading the Postgres *engine* version itself (e.g. `17.4.1.054` → `17.6.1.166`) via the Supabase dashboard's "Upgrade project" button (Infrastructure settings). Like all production changes, this is a human's action to take deliberately — see [How production gets changed](#how-production-gets-changed) above for why. Track it as a GitHub issue with a pre-upgrade checklist: downtime window outside cron activity (`vercel.json` has the schedules), in-place vs. pause-and-restore, and confirming a backup point exists.

A quarterly reminder issue is opened automatically — see `.github/workflows/postgres-upgrade-check.yml` — so this doesn't depend on someone noticing a security advisory.

### Post-upgrade checklist — do not skip this

An in-place upgrade changes the collation library the underlying OS provides, but Supabase's automated upgrade only refreshes the recorded collation-version stamp on the project's primary application database — not on the `postgres` and `template1` system databases. Left alone, every connection Postgres's own autovacuum launcher makes to those two (its normal per-database cadence, unrelated to your app's traffic) logs a `database "X" has a collation version mismatch` WARNING. On `membership-system-prod` this took the Postgres log volume from a ~630/day baseline to 10,000+/day within the hour of a September 2026 upgrade, and was the direct cause of a disk-I/O-budget alert two days later.

Run this immediately after every upgrade, against both `membership-system-prod` and `membership-system-dev`:

```sql
ALTER DATABASE postgres REFRESH COLLATION VERSION;
ALTER DATABASE template1 REFRESH COLLATION VERSION;
```

The `template1` statement is expected to fail with `must be owner of database template1` — it's owned by an internal Supabase role, not the `postgres` role you connect as, and can't be fixed from the SQL editor or the Supabase MCP. That's fine: `template1` sees far fewer connections than `postgres` does, so it's a small fraction of the warning volume, and nothing in this app ever connects to it. Leave it rather than filing a support ticket.

Then:

- Re-run **both** the security and performance advisors (`get_advisors`, or the dashboard's Advisors page). The collation-mismatch lint surfaces under performance, not security — a security-only re-check (as issue #289 originally asked for) will report clean while the warning flood is still running.
- Watch `postgres_logs` volume for the next 24–48h (`query_logs` filtered to `source = 'postgres_logs'`, or the dashboard Logs Explorer) to confirm it's back near baseline, and watch the Disk I/O graph on the project's Health page.

## Views and functions are public API

Supabase publishes everything in the `public` schema through PostgREST, so a view or function is reachable from the internet with the (public) anon key as soon as it is granted to `anon` — which, for views and tables, used to happen automatically. Three rules, all enforced by `npm run migrations:lint` (a blocking CI step) — the third is the next section:

- **Every view must be created `WITH (security_invoker=true)`.** Without it a view runs as its owner and ignores RLS on the tables underneath, and any role that is granted SELECT on it reads the underlying tables unfiltered. All nine existing views set this.
- **Never `GRANT EXECUTE ... TO anon`/`authenticated`/`PUBLIC` without a stated reason, and revoke the default `PUBLIC` EXECUTE on every new function.** PostgreSQL gives `PUBLIC` EXECUTE on every new function, `anon` and `authenticated` inherit it, and `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ... FROM PUBLIC` cannot remove it (so `20260907000002_revoke_public_function_access.sql` fixed the functions that existed at the time, not future ones). A new function, `SECURITY DEFINER` above all, is therefore callable by `anon` over `/rest/v1/rpc/` until its own migration says `REVOKE EXECUTE ON FUNCTION public.f(...) FROM PUBLIC;` (plus `FROM anon, authenticated` if they were granted). Every `.rpc()` call in this repo uses `createAdminClient`, so after the revoke grant `EXECUTE ... TO service_role` explicitly: since 2026-10-30 Supabase no longer grants `service_role` EXECUTE on new functions either, and a function without the grant fails with `42501` on a rebuild. The lint flags a `GRANT EXECUTE` whose grantee list names `anon`, `authenticated` or `PUBLIC`.

### Grants on new tables, views and sequences

Table privileges and RLS are two separate gates, and a request has to pass both. Supabase used to open the privilege gate for you on everything created in `public`; since 2026-10-30 it does not, so a new object is closed to every API role until a migration opens it. Existing objects were not touched, and `20261102170500_explicit_public_grants.sql` writes their current privileges down so a rebuild (a scratch database, a new dev project) matches production.

**Rule: every migration that creates a table, view or sequence in `public` includes an explicit, least-privilege `GRANT` alongside `ENABLE ROW LEVEL SECURITY` and the policies.** For example:

```sql
CREATE TABLE IF NOT EXISTS public.widgets ( ... );
ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;
-- policies ...

-- Only server code (createAdminClient) touches this table: service_role is enough.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.widgets TO service_role;
-- Read by the signed-in browser client (RLS decides which rows):
GRANT SELECT ON public.widgets TO authenticated;
```

- **Least privilege means the narrowest verbs, to the narrowest roles, that the access path needs.** Find the access path first: a table that is only reached through `createAdminClient()` needs `service_role` alone. `authenticated` gets only the verbs the signed-in browser client uses, and `anon` only if a logged-out visitor must read it (almost nothing qualifies). Never grant `TRUNCATE`, `REFERENCES`, `TRIGGER` or `MAINTAIN` (PostgreSQL 17+) to `anon` or `authenticated`: RLS gates the four DML verbs but not those (`TRUNCATE` empties a table with no row filter, `REFERENCES` and `TRIGGER` let the holder add a foreign key or trigger, `MAINTAIN` allows `VACUUM`/`ANALYZE`/`REINDEX`/`CLUSTER`/`LOCK`), and PostgREST never uses them. `20261102170500_explicit_public_grants.sql` still lists all seven verbs for all three roles because that is what the old Supabase defaults left on production, and `20261102180000_revoke_truncate_references_trigger_from_api_roles.sql` then revokes them (`MAINTAIN` only on PostgreSQL 17+, in a version-guarded `DO` block) from `anon` and `authenticated` on every table and view, and from the `postgres` default ACL for tables in `public`, so tables created later do not get them back; today they hold `SELECT, INSERT, UPDATE, DELETE` at most (`service_role` keeps all seven). Do not copy either file's grant list into a new migration — grant the narrowest DML verbs the access path needs. `npm run migrations:lint` prints a non-blocking warning when a newer migration grants `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN` or `ALL` on a table or view (or via `ALTER DEFAULT PRIVILEGES ... ON TABLES`) to `anon`, `authenticated` or `PUBLIC` (`-- lint-ok: <reason>` on the line above silences it).
- **A `GRANT` without a policy is not access, and a policy without a `GRANT` is not either.** Add both, and keep `ENABLE ROW LEVEL SECURITY` — `npm run schema:verify` fails a table without it.
- **Views:** `CREATE VIEW ... WITH (security_invoker=true)` and grant `SELECT` only; a reporting view read by a server route needs `service_role` and nothing else. The caller also needs privileges on the tables underneath, since the view runs with the caller's rights.
- **Sequences:** a column default that calls `nextval()` (a `serial` column, or a hand-made sequence like `member_id_seq`) runs as the inserting role, so that role needs `USAGE` on the sequence. `GENERATED ... AS IDENTITY` columns need no sequence grant; `INSERT` on the table is enough.
- **Functions are separate:** see the EXECUTE rule above. A new function is executable by `PUBLIC` (so by `anon`) until its migration revokes that, and `service_role` needs an explicit `GRANT EXECUTE` — `npm run schema:verify` checks that the functions the app calls over RPC hold it. Add a service-role-only function (or a service-role-only table or view) to `scripts/ci/schema-verify-expectations.txt`; `schema:verify` reads its allow-list from there, and any other public table or view must be readable by `anon` and `authenticated`.
- **`CREATE OR REPLACE VIEW` keeps its privileges**; `DROP` + `CREATE` does not, so re-grant after a drop.
- **Verify before reporting done:** `npm run migrations:lint` (flags a missing `GRANT`; `-- lint-ok: <reason>` on the line above allows an object no API role may reach) and `npm run schema:verify` (applies the schema to a server with no default privileges, which is the post-2026-10-30 situation).
- **Reading live grants:** `select relname, relacl from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p','v','m','S')`. Compare dev and production before assuming they match.

`SECURITY DEFINER` deserves particular care: such a function ignores RLS entirely, so combining it with a public grant exposes whatever it selects. Three ad-hoc export functions reached production that way and returned every member's name, email and member_id to unauthenticated callers.

When an external consumer (a spreadsheet, a dashboard) needs data, the answer is an authenticated API route, never a view or function — see [README § Exposing Data to External Consumers](README.md#exposing-data-to-external-consumers) and `src/app/api/admin/exports/members/route.ts` for the reference implementation.

## Supabase relation queries

The Supabase clients in `src/lib/supabase/` (`createServerClient`/`createBrowserClient`/`createClient`) don't pass the generated `Database` type as a generic, so it defaults to `any` — `.select()` results, including embedded relations (joins), are not compiler-checked by default. When postgrest-js can't resolve real foreign-key cardinality from schema metadata, it silently infers **every** embedded relation as an array, even a true one-to-one "belongs-to" join. Don't trust the inferred type's array-ness as a signal of real cardinality, and don't blindly add `[0]` indexing or `Array.isArray()` handling to silence a type error without checking first.

Before writing access code for a joined relation, check the actual foreign key in `supabase/migrations/20260907000000_baseline_schema.sql` (its `FOREIGN KEYS` section lists every one, `table, constraint, definition`) or the generated `supabase/schema.sql`: a FK column defined on the table you're querying *from*, pointing at the joined table (`NOT NULL` or nullable), means that relation is single-object — write `.name` / `?.name` access, not array handling. A FK defined on the *other* table pointing back at you means it's genuinely one-to-many. Once cardinality is verified, declare it explicitly with `.overrideTypes<T, { merge: false }>()` (the current, non-deprecated replacement for the old `.returns<T>()`) on the query, so the compiler enforces the real shape instead of silently allowing `any`.

`src/types/database.ts` is a manually-maintained/generated snapshot that's known to drift from the live schema (for example, it's missing the `registration_categories` table entirely, and some FK relationships/columns added in later migrations aren't reflected). Don't treat it as authoritative for cardinality — check the migrations directly. When your change adds a new table/column that other code will read via a `Database[...]` annotation, update `database.ts` in the same change.

## Admin pages

When adding a new admin page, add it to navigation and verify it's reachable by clicking, not by URL.

## Admin API routes

Every admin-only API route starts with the shared guard and returns its response unchanged:

```ts
import { requireAdmin } from '@/lib/auth/require-admin'

const auth = await requireAdmin()
if (!auth.ok) return auth.response // 401 with no session, 403 for a non-admin
```

Put admin routes under `/api/admin/`. `src/proxy.ts` applies the same check to `/api/admin/*` as a backstop (JSON 401/403, not a redirect). The exception is `/api/admin/exports/*`, which authenticates with its own bearer secret. An admin route outside `/api/admin/` (for example `/api/xero/accounts`) is protected only by its own `requireAdmin()` call. Scheduled jobs use `authorizeCronRequest` from `src/lib/cron/auth.ts` (`Authorization: Bearer $CRON_SECRET`) instead, as `/api/cron/*` and `/api/xero/keep-alive` do. Don't add debug or test routes without one of these guards; remove them once they've served their purpose. `src/__tests__/api/admin-route-guards.test.ts` covers the guarded routes. Add a new admin route outside `/api/admin/` to it.

## Loops email templates

`email_logs` is written only by server code with the service-role client (`src/lib/email/*`, the admin sync route, the housekeeping cron). Rows are sent by the email cron, so only server code may create or change them: `anon` and `authenticated` hold `SELECT` only and there is no `INSERT`/`UPDATE` policy (`20261109214500_email_logs_server_writes_only.sql`). Keep it that way when you add an email path: insert through `createAdminClient()`. `npm run schema:verify` runs `scripts/tests/email-logs-write-access-db-test.sql`, which fails if the API roles can write the table again.

When adding a new Loops transactional email template, prepend `{testEmailPrefix}` to the Subject field in the Loops dashboard (mark it optional as a safety net) — see [README.md § Email Integration Setup (Loops.so)](README.md#email-integration-setup-loopsso). The app already sends `testEmailPrefix` in `dataVariables` on every send (`[TEST] ` on preview/local, `''` in production — see [src/lib/email/environment.ts](src/lib/email/environment.ts)); no code changes are needed for a new template beyond the dashboard edit.

Every template's footer uses a standard reusable "Dashboard" button component, which reads a `dashboardUrl` data variable (exact camelCase key — some sending code also sets a `dashboard_url` snake_case variant for its own body copy, but the footer button specifically needs `dashboardUrl`). When wiring up code that sends a new template, always include `dashboardUrl: \`${process.env.NEXT_PUBLIC_SITE_URL}/user\`` in `dataVariables`/`email_data` — it's environment-specific, so it can't be hardcoded into the template itself. There is no `/user/dashboard` route (`/user` is the actual user-facing dashboard page); use `/user`, never `/user/dashboard` (which 404s). Omitting or mistyping this doesn't fail the send; Loops just renders the footer button with a broken link, and nothing surfaces the mistake until someone clicks it.

## Supabase auth email templates

Supabase's own auth emails (magic link, recovery, invite) are project settings, not repo state — nothing in `supabase/migrations/` or `schema.sql` touches them. One of them is codified: the magic-link body lives in `supabase/auth-templates/magic-link.html`. Login makes a single `signInWithOtp()` call, so that one email serves both sign-in methods and must carry both the `{{ .Token }}` code (typed into `/auth/verify-otp`) and a link to `/auth/magic-confirm?token_hash={{ .TokenHash }}&type=magiclink` (Supabase's default PKCE link cannot be verified by that page). Drop either one and half the login screen stops working.

`npm run auth:verify` checks that file offline and is a blocking CI step; `npm run auth:check` checks a live project (needs `SUPABASE_ACCESS_TOKEN`); `npm run auth:apply` writes it. If you change how magic-link confirmation works, change the template in the same commit — CI catches a template that no longer points at `/auth/magic-confirm`, but nothing catches a live project until someone tries to sign in. No other auth template is managed; leave the rest alone unless you are extending `scripts/configure-auth-templates.js` deliberately.

## Error reporting (Sentry)

Report errors through `logger.error`/the category helpers (`src/lib/logging/logger.ts`) or `src/lib/sentry-helpers.ts` — never call `Sentry.captureException`/`captureMessage` directly. See [README.md § How to Report Errors](README.md#3-how-to-report-errors-and-why-its-reliable-on-vercel) for which of the two to use, how to pass a real caught error through the logger so Sentry gets a real stack, and why bypassing both (an un-flushed direct Sentry call) can silently drop the event on Vercel (#368).

## Git workflow

Both `development` and `main` are protected — neither accepts a direct push, so every change goes through a PR:

1. **Feature branch → `development`.** Always start work on a new branch off `development` named `fix/<short-description>` or `feature/<short-description>` (e.g. `fix/419-dialog-overflow`) — never commit or push to `development` or `main` directly, even if your session or tooling suggests a different branch. Commit there, open a PR back into `development`, and **squash merge** it (see [README § Git Merge Strategies](README.md#git-merge-strategies)). This is the PR to write a normal `Closes #NNN` on, and where review/CI for the actual change happens.
2. **`development` → `main`.** Once enough work has accumulated on `development` (or a specific fix needs to ship), open a second PR promoting `development` into `main` and **merge it with a regular merge commit, not squash**, so `development`'s history is preserved on `main`.

Don't try to push a feature branch, or `development` itself, straight to `main`, and don't push directly to `development` expecting it to land — the branch ruleset rejects it and a PR is required either way.

### Before opening a PR: check the docs

Docs in this repo go stale quietly. The README said "Node.js 18+" long after Next 16 required 20.9, and a never-run Cloud Run workflow sat in `.github/workflows/` for over a year implying the app deployed somewhere it didn't. So before opening any feature PR, search the docs for whatever the change touches and update them in the same PR:

- **What to search for:** every name the diff adds, renames or removes — env vars, routes, scripts/`npm run` commands, file and directory paths, table/column names, workflow names, versions (Node, Next, Stripe API), and external services.
- **Where:** `README.md`, `AGENTS.md`, `docs/`, `.env.example` (see [Environment variables](#environment-variables)), `supabase/auth-templates/`, and comments in `.github/workflows/`. For example, `git grep -n -i '<name>' -- '*.md' docs .env.example .github`.
- **Removals count too.** Deleting a feature, script or integration means deleting or rewriting the docs that describe it, not just the code.
- **Say what you checked.** In the PR description, list the docs you updated, or write one line saying you searched and none needed changes. Don't skip it silently, so a reviewer can tell "checked, nothing to change" from "didn't look".

Promotion PRs (`development` → `main`) don't need this. The docs were checked in the feature PRs they carry.

### Promoting `development` into `main`

`main` is the repository's default branch, and **GitHub only auto-closes an issue when the closing keyword appears in a PR whose base is the default branch** (or in a commit message pushed to it). A `Closes #NNN` written in the feature PR — the one merged into `development` — does nothing by itself: the issue stays open through the whole `development` cycle and only closes if the promotion PR body repeats the keyword. A bare `#NNN` (no `closes`/`fixes` before it) creates a cross-reference but is **not** a closing keyword and won't close anything.

When opening a promotion PR:

- **Reference the source PR(s)**, but don't restate their descriptions — the merge commit preserves the history and the link is enough. "Merges `development` into `main`; see #NNN" is fine.
- **Repeat every closing keyword.** Every `Closes #NNN` / `Fixes #NNN` from the PRs being promoted has to appear in the promotion PR body too, or those issues silently stay open. This is the one part of a promotion PR body that isn't ceremonial — don't drop it for a terser summary.

## Before reporting work complete

Run `npm run build` and paste the raw, unfiltered output — including the final success or error lines. Do not summarize, scope, or filter the result (e.g. "0 errors in modified files"). If the build fails, fix it and re-run; do not report completion with a failing build.

`npx tsc --noEmit` is a faster subset useful during iteration, but it is not a substitute: `npm run build` additionally parses pages and components that no test imports, runs lint, and validates server/client boundaries. `npm run build` type-checks too, and CI runs `npm run typecheck` (`tsc --noEmit`) as a blocking step, so type errors fail the build either way. Run `npx tsc --noEmit` during iteration anyway since it's faster than a full build.

If a bare `npx tsc --noEmit` aborts immediately with `TS2688 Cannot find type definition file for '<pkg> 2'` errors before checking any real source file, that's a stray macOS-sync duplicate-directory artifact in `node_modules/@types` (e.g. `babel__core 2`), not a real problem — work around it with `npx tsc --noEmit --typeRoots ./node_modules/@types`. `npm run build` is unaffected by this.

The same applies to test runs: paste the actual Jest output, not a description of it.

## Linting

`npm run lint` is a blocking CI step — a lint error fails the build, not just a warning. Run it before reporting work complete and fix anything it flags in files you touch.
