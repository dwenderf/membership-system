# Phase 3 — Admin Management and Reporting

**Status:** 📋 Ready for implementation — decisions resolved
**Created:** 2026-07-27
**Updated:** 2026-07-27
**Parent spec:** [Per-User Discount Allowances](./user-discount-allowances.md)
**Depends on:** Phase 2 (schema + resolver) and the [percentage resolution gap fix](./discount-allowances-percentage-resolution-gap.md) — both merged
**PR scope:** One PR covering admin API, admin UI, and reporting.

> **Numbering note.** The parent spec originally split this into Phases 3, 4 and 5. Committed code
> and production migration comments now use "Phase 4" to mean the flip, so the numbering has been
> collapsed to match what is already written down: **Phase 3 = admin management + reporting**,
> **Phase 4 = the flip**. Update the parent spec accordingly.

## Purpose

Give admins a way to grant, edit, and revoke per-user discount allowances, and make the reporting
surfaces reflect per-user limits rather than category defaults.

This is the phase that makes allowances real. Every prior phase was inert; the moment this ships,
allowance rows exist and take effect immediately.

## Scope

- Admin API for reading and writing allowances
- Allowance editor on the user detail page, alongside discount usage
- `requires_user_allowance` control on the category admin page
- New discount **eligibility** report
- Per-user resolution in the existing discount **usage** report and in
  `getSeasonalDiscountUsageSummary`
- Minor fix: the alternates list flags ineligible users as "over limit"

## Non-Goals

- Gating any category, activating `PRIDE`, deactivating legacy codes — Phase 4
- Bulk or CSV allowance entry. Aid is approved case by case, so entry is single-user by design
- Auto-applying discounts at checkout
- Member-facing balance display. RLS already permits it; the UI is not in scope
- Copying allowances between seasons
- Any use of `is_default` or `priority`. Both columns exist and are read by nothing. They are for
  auto-apply, which is unscheduled. **Do not build UI or selection logic on them.**
- **Any UI for `discount_categories.default_percentage`** — see D1. The column stays in the schema
  but nothing sets or reads it.

## Decisions — RESOLVED

Confirmed by the maintainer. Binding.

### D1 — Explicit values only; no state expressed by emptiness

`default_percentage` is `NULL` on all five production categories and has never been settable. An
"inherit the default" mode would inherit nothing — a trap rather than a feature. Therefore:

- **Percentage is required, 1–100.** The UI never writes a `NULL` percentage.
- **The category's `max_discount_per_user_per_season` is NOT inherited** as a per-user cap. It is
  not per-season, which is the reason the cap moved onto the allowance in the first place.
- **An uncapped allowance is set by an explicit "No dollar cap" toggle**, not by leaving a field
  blank. This is needed for gated-but-uncapped categories such as Board Member.
- **Revocation writes `max_discount_amount = 0`** and leaves the row intact.

| UI state | `discount_percentage` | `max_discount_amount` |
|---|---|---|
| Active, capped | 1–100 (required) | dollars → cents, `> 0` |
| Active, uncapped | 1–100 (required) | `NULL`, via explicit toggle |
| Revoked | unchanged | `0` |

No state is expressed by an empty field. The resolver's existing handling of a `NULL` percentage
(allowance-driven code becomes ineligible — fail closed) remains as a safety net for rows created
by direct SQL.

Also: **remove `default_percentage` from the category admin UI scope.** Nothing reads it once
every allowance carries its own percentage, and offering a control would reintroduce the ambiguity
this decision removes.

### D2 — Cents in the database, dollars and cents in the UI

`max_discount_amount` is integer cents, consistent with the rest of the schema. The UI displays and
accepts dollars and cents. Specify where conversion happens and validate it: `$250.00` must store
`25000`. This error fails in the generous direction and is invisible until someone gets a
hundred-fold discount.

### D3 — Existing allowances plus an "Add allowance" control

The editor lists the user's existing allowance rows for the current and upcoming seasons. A
separate "Add allowance" action picks a season and a category from combinations not yet used.

Rejected: listing every category × season with empty states. With 5 categories and 2 seasons that
is 10 permanently-empty rows on a page that already carries payment plan, admin access, and
discount usage sections, and the overwhelming majority of users have no allowances at all.

The tradeoff is that an admin cannot tell from the user page which categories are gated. That is
what the eligibility report is for.

### D4 — A separate eligibility report, not a category-page tab

Add a **discount eligibility** report under `/admin/reports/`, grouped by season like the existing
discount usage report, showing per user: category, percentage, limit, amount used, and remaining.

This is not a duplicate of `discount-usage`. The two answer different questions from different
sources, and the populations differ:

- **Usage** — who spent what, derived from `discount_usage_computed` (invoices)
- **Eligibility** — who was granted what, derived from `user_discount_allowances`

A member granted $750 who has not yet registered appears in eligibility and not in usage. That
person is exactly who the Phase 4 pre-flight check needs to find.

Both reports must read limits through `resolveEffectiveDiscountLimits` so they cannot drift.

Additionally, surface **both usage and eligibility** on `/admin/reports/users/[id]`.

### D5 — Show the resolution source

Include `source` (`'user_allowance'` / `'category_default'` / `'denied'`) in the eligibility report.
It is also a diagnostic: once Financial Aid is gated, any row there showing `category_default` is a
bug.

## Current State

**Schema** (live in production, unused): `user_discount_allowances` with `discount_percentage` and
`max_discount_amount` both nullable, plus `notes`, `created_by`, `updated_by`, `is_default`.
`discount_categories` has `requires_user_allowance`, `default_percentage`, `priority`.

**Resolver:** `resolveEffectiveDiscountLimits` and `resolveEffectiveDiscountLimitsBatch` in
`discount-limit-service.ts` are the single source of resolution truth. **No UI or report may
reimplement the rules.**

**Pattern to follow:** `/api/admin/users/[id]/payment-plan-eligibility` and
`PaymentPlanSection.tsx` on `/admin/reports/users/[id]`. Same auth shape, same section layout.

**Note:** there are no generated Supabase types and the client is untyped. A wrong column name will
not fail the build or the mocked tests. Select columns explicitly, never `*`.

## API

### `/api/admin/users/[id]/discount-allowances`

- **GET** — allowance rows for the current and upcoming seasons, each with computed used and
  remaining from `discount_usage_computed`, plus the list of season/category combinations still
  available to add
- **PUT** — upsert one allowance for a `(user, season, category)` triple
- **DELETE** — not used for revocation (D1). Include only if there is a genuine created-in-error
  case, and say so explicitly.

Requirements:

- `is_admin` check before anything, matching `payment-plan-eligibility`
- `createAdminClient()` for writes
- `logger.logAdminAction` on every mutation, recording before and after values
- `created_by` on insert, `updated_by` on update, both from the acting admin
- Validation mirroring the DB constraints, with usable error messages rather than raw constraint
  violations: percentage required and `> 0 and <= 100`; cap either `NULL` (uncapped) or `>= 0`
- Reject writes to past seasons. Current is `start_date <= now() <= end_date`; upcoming is
  `start_date > now()`

### Season scope

Current and upcoming seasons only, everywhere in this phase. Past seasons are neither listed nor
writable.

## UI

### `DiscountAllowanceSection.tsx` — `/admin/reports/users/[id]`

Modeled on `PaymentPlanSection.tsx`. Lists existing allowances grouped by season:

- Category, percentage, and cap — or "No dollar cap"
- Used and remaining for the season, from `discount_usage_computed`
- `notes` — matters for the aid conversation and survives revocation
- Who last changed it and when, from `updated_by` / `updated_at`
- Revoke action (writes `0`, row stays visible and restorable)
- "Add allowance" action for unused season/category combinations

Place adjacent to the existing `DiscountUsage` component, or absorb it, so grant and consumption
read together.

### `/admin/discount-categories`

Add `requires_user_allowance` only. The checkbox needs a warning: enabling it denies every user
without an allowance for that category, immediately.

Do **not** add a `default_percentage` control (D1).

### Alternates list fix

`src/app/api/alternate-registrations/[gameId]/alternates/route.ts` sets `isOverLimit = true` for
ineligible users, so a captain sees an "over limit" badge on someone who was never eligible.
Separate the two states in the response and in the UI.

## Reporting

- **New:** discount eligibility report (D4), grouped by season, showing user, category, percentage,
  limit, used, remaining, and `source`
- **⚠️ Register the new report in navigation.** There is no `/admin/reports/page.tsx` index — report
  links are maintained by hand, so a new report page is unreachable until it is added. Do not guess
  the location: grep for `reports/discount-usage` across `src/` and add the eligibility report
  everywhere that path is linked (the admin dashboard at `src/app/admin/page.tsx`, plus any shared
  nav or menu component). This step is routinely missed.
- **Fix:** `/api/admin/reports/discount-usage` computes `remaining` and `isFullyUtilized` from
  `category.maxPerUser`. Must resolve per user
- **Fix:** `getSeasonalDiscountUsageSummary` in `discount-limit-service.ts` reads only
  `max_discount_per_user_per_season`. Must resolve per user
- Both reports resolve through `resolveEffectiveDiscountLimits`

## Operational Notes for the Data-Entry Window

The gap between this PR and Phase 4 is when admins enter every allowance while the old codes still
work and nothing is gated. Two things whoever does that entry must know, and which belong in the UI
as help text:

1. **Allowance rows take effect immediately, not at the flip.** A member granted 50% / $250 is
   capped at $250 from the moment it saves, while everyone else still has the category's $750.
2. **During this window a member may redeem a legacy fixed-percentage code** (`PRIDE75`) and
   receive 75% capped by their allowance dollar limit. This is expected and was accepted as
   correct-but-temporary (decision D5 of the parent spec). It ends when Phase 4 deactivates the
   legacy codes.

## Acceptance Criteria

- Admin can create, edit, and revoke an allowance for current and upcoming seasons
- Past seasons are neither listed nor writable
- Percentage is required and constrained to 1–100; the UI cannot write a `NULL` percentage
- "No dollar cap" writes `NULL`; no state is expressed by an empty field
- `$250.00` entered stores `25000`; verified by a round-trip test
- Revocation writes `0` and preserves `notes`, `created_by`, `updated_at`; the row stays visible
- Every mutation appears in the admin action log with before/after values
- Non-admins receive 403 from every endpoint
- Used and remaining on the user page match `discount_usage_computed`
- The usage report and `getSeasonalDiscountUsageSummary` resolve limits per user
- The eligibility report lists every allowance holder for a season, including those with no usage
- The eligibility report is reachable by clicking through the admin UI from the dashboard — not
  only by typing the URL
- Ineligible users are visually distinct from over-limit users on the alternates list
- **No UI or report reimplements resolution.** Effective values come from
  `resolveEffectiveDiscountLimits`
- Existing test suites pass unmodified, including both payment services and the cross-path
  integration suite

## Testing

- Round-trip: `$250.00` → `25000` → displays `$250.00`
- Percentage validation rejects `0`, `101`, and empty
- "No dollar cap" round-trips as `NULL` and resolves as unlimited
- Revocation leaves the row with `0` and intact notes; a revoked member is denied at checkout
- Granting an allowance on an ungated category caps a fixed-percentage code — the case verified
  manually in Phase 2 at $0.30 and $300
- Non-admin access returns 403 on GET, PUT, and DELETE
- Report figures match the resolver for a user with an allowance and for one without
- Eligibility report includes a user with an allowance and zero usage
- Usage and eligibility reports agree on limit and remaining for the same user and season

## Phase 4 Pre-Flight (produced by this phase)

Before the flip, the eligibility report must confirm that every intended Financial Aid recipient
has an allowance row for the season with a resolvable percentage. A gated category with a missing
row means a member who received aid last season silently gets none.
