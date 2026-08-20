# Agent Instructions

Instructions for AI coding agents working in this repository.

## Testing the UI

The login screen (magic link/OTP, Google OAuth, passkey) can't be driven by automated tools. On preview deployments, use the login bypass endpoint instead of trying to automate the real login flow — see [README.md § Preview auth bypass for automated testing](README.md#preview-auth-bypass-for-automated-testing) for the endpoint, required env vars, and one-time setup.

## Environment variables

This repo is linked to Vercel (`nycpha/membership-system`). A fresh git worktree has no `.env.local` and no `.vercel/` link, so set both up rather than copying a `.env.local` from elsewhere (different checkouts can point at different Supabase projects, and a stale copy silently drifts from what's actually configured):

1. Link the worktree: copy `.vercel/project.json` from an already-linked checkout in this repo (it's just a project ID + org ID, not a secret), or run `vercel link` if none exists.
2. Pull real values: `vercel env pull .env.local`. This targets the `development` environment by default — a var scoped only to `Preview` in the Vercel dashboard won't come through. If a build fails on a var that's missing from `development`, don't assume it's absent from Vercel entirely; check its environment scope in the dashboard, or retry with `vercel env pull .env.local --environment=preview` if directed to do so.

**This assumes an already-authenticated `vercel` CLI.** A fresh Claude Code on the web / other cloud session has no cached login (`~/.vercel/auth.json`) and no `VERCEL_TOKEN`, and `vercel login`'s OAuth flow needs an interactive browser the sandbox doesn't have — so steps 1–2 above silently aren't available there, even though they work fine in a local session. Enabling the Vercel MCP connector doesn't substitute for this: it manages projects/deployments/logs but has no tool for reading environment variable values. If you're stuck this way and need `npm run build`/tests to get past a missing var, don't fabricate real credentials or claim a build validated real integrations — either ask the user to run `vercel env pull` locally and share the resulting `.env.local`, or use placeholder values (e.g. `XERO_CLIENT_ID=placeholder`) purely to satisfy module-level `if (!process.env.X) throw` guards, and say explicitly that this only verifies compilation, not behavior against real services.

`.env.example` is the source of truth for which env vars the app expects. When you add code that reads a new `process.env.X`, add `X=` (key only, never a real value) to `.env.example` in the same change.

## Database migrations

Migrations are applied manually by the maintainer. Write the migration file only. Do not run `supabase db push`, `db reset`, `migration up`, or `supabase link` under any circumstances. Do not attempt to verify the migration by connecting to the database. The migration file existing in `supabase/migrations/` is the complete deliverable.

## Admin pages

When adding a new admin page, add it to navigation and verify it's reachable by clicking, not by URL.

## Before reporting work complete

Run `npm run build` and paste the raw, unfiltered output — including the final success or error lines. Do not summarize, scope, or filter the result (e.g. "0 errors in modified files"). If the build fails, fix it and re-run; do not report completion with a failing build.

`npx tsc --noEmit` is a faster subset useful during iteration, but it is not a substitute: `npm run build` additionally parses pages and components that no test imports, runs lint, and validates server/client boundaries.

The same applies to test runs: paste the actual Jest output, not a description of it.

## Linting

CI's lint step is currently non-blocking (`continue-on-error: true`) while a pre-existing backlog gets paid down (issue #197) — don't take that as license to add to it. Run `npm run lint` before reporting work complete and don't introduce new errors or warnings in files you touch, even though CI won't fail on them yet. If your task is specifically a #197 sub-issue, verify with `npm run lint`, `npm test`, and `npm run build` as its plan describes.
