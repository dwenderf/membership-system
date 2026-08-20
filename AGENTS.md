# Agent Instructions

Instructions for AI coding agents working in this repository.

## Testing the UI

The login screen (magic link/OTP, Google OAuth, passkey) can't be driven by automated tools. On preview deployments, use the login bypass endpoint instead of trying to automate the real login flow — see [README.md § Preview auth bypass for automated testing](README.md#preview-auth-bypass-for-automated-testing) for the endpoint, required env vars, and one-time setup.

## Database migrations

Migrations are applied manually by the maintainer. Write the migration file only. Do not run `supabase db push`, `db reset`, `migration up`, or `supabase link` under any circumstances. Do not attempt to verify the migration by connecting to the database. The migration file existing in `supabase/migrations/` is the complete deliverable.

## Admin pages

When adding a new admin page, add it to navigation and verify it's reachable by clicking, not by URL.

## Before reporting work complete

Run `npm run build` and paste the raw, unfiltered output — including the final success or error lines. Do not summarize, scope, or filter the result (e.g. "0 errors in modified files"). If the build fails, fix it and re-run; do not report completion with a failing build.

`npx tsc --noEmit` is a faster subset useful during iteration, but it is not a substitute: `npm run build` additionally parses pages and components that no test imports, runs lint, and validates server/client boundaries.

The same applies to test runs: paste the actual Jest output, not a description of it.
