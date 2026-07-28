# Phase 2 — Allowance Schema and Resolver

**Status:** 📋 Ready for implementation — decisions resolved
**Created:** 2026-07-27
**Parent spec:** [Per-User Discount Allowances](./user-discount-allowances.md)
**Depends on:** Phase 1 (consolidation) — merged
**PR scope:** Migration + resolver. Ships dormant: no allowance rows can exist until Phase 3 provides the UI, and no category is gated until the Phase 4 flip.

## Purpose

Introduce `user_discount_allowances` and teach `discount-limit-service.ts` to resolve a user's
effective discount percentage and seasonal cap from it, falling back to category defaults.

After this PR the system is fully capable of per-user allowances and gatekeeping, but nothing
exercises it. That is deliberate — it puts the risky logic in production where it can be observed
while it is still inert.

## Scope

- Migration: new table, new columns on `discount_categories` and `discount_codes`, indexes, RLS
- Resolver in `discount-limit-service.ts`
- Percentage resolution for allowance-driven codes at every site that computes a discount amount
- Batch allowance lookup for the captain alternate list

## Non-Goals

- Admin API or UI for creating allowances — Phase 3
- Gating any category, activating `PRIDE`, or deactivating legacy codes — Phase 4
- Auto-applying discounts at checkout — not scheduled
- Using `is_default` or `priority` for anything. Both columns are created and left unread; they
  exist for auto-apply. Do not build selection logic on them.
- Updating `/api/admin/reports/discount-usage` — Phase 3, where it ships alongside the UI that
  makes it wrong

## ⚠️ Migration Handling

**Migrations in this project are applied manually by the maintainer.** Write the migration file
only. Do not run `supabase db push`, `db reset`, `migration up`, or `supabase link`. Do not
connect to the database to verify. The file existing in `supabase/migrations/` is the complete
deliverable.

A draft exists at `supabase/migrations/2026-07-27-add-user-discount-allowances.sql`. **It requires
three corrections before use** — see below.

### Required corrections to the drafted migration

The draft was written before the phased rollout was settled and performs the Phase 4 cutover
inline. All of it must move out:

1. **`PRIDE` must be inserted with `is_active = false`.** Currently `true`. An active
   allowance-driven code with no allowance rows and no category `default_percentage` resolves to
   a null percentage — undefined behavior on a guessable code.
2. **Do not set `requires_user_allowance = true` on Financial Aid.** The draft does this in a
   `DO` block. Gating the category while PRIDE25/50/75/100 are still the live codes would make
   Financial Aid unusable immediately.
3. **Do not deactivate PRIDE25/50/75/100.** Same reason. They remain the working codes until the
   Phase 4 flip.

What remains in the Phase 2 migration: schema only, plus the inactive `PRIDE` row. Every data
change lands in Phase 4 as three statements.

## Current State (post-Phase 1)

`discount-limit-service.ts` is the single enforcement path. Relevant exports:

- `checkSeasonalDiscountLimit(supabase, userId, discountCodeId, seasonId, requestedDiscountAmount, options?)`
- `calculateSeasonalDiscountUsage(supabase, userId, categoryId, seasonId)`
- `calculateSeasonalDiscountUsageBatch(supabase, userIds[], seasonId)`
- `evaluateSeasonalDiscountLimit(category, currentUsage, requestedDiscountAmount)` — pure

Callers: `validate-discount-code` (checkout + admin refund modal), the alternate list route,
`AlternatePaymentService`, `WaitlistPaymentService`.

**Critical detail:** every caller computes `requestedDiscountAmount` *itself* from
`discountCode.percentage` before calling the service. The service caps an amount; it does not
compute one. Allowance-driven codes have `percentage = NULL`, so this is the main structural
problem Phase 2 has to solve. See D1.

**Note also:** there are no generated Supabase types and the client is untyped, so a wrong column
name will not fail the build or the mocked tests. Select columns explicitly, never `*` — this is
exactly how the dead `usage_limit` check survived undetected for years.

## Decisions — RESOLVED

> Resolved by the maintainer, 2026-07-27. The positions below are **binding**. The options in each
> subsection are retained as rationale, not as open choices.
>
> - **D1 → (c).** The resolver returns percentage and limit in one object. One database read;
>   the caller computes the amount and passes the resolved object into
>   `evaluateSeasonalDiscountLimit`.
> - **D2 → derive from the original line item.** Refunds must not re-resolve the percentage. The
>   allowance is mutable, so re-resolution can produce a credit note that does not match the
>   original invoice. `isRefund` bypasses eligibility, cap, and percentage re-resolution alike.
> - **D3 → "This code isn't available to your account."** Use this wording. A generic "invalid
>   code" was considered and rejected: a member who has been told they qualify but has not yet
>   been set up by an admin would be misled by it. The message must still leak neither the cap
>   nor the category.
> - **D4 → batch as recommended.** `resolveEffectiveDiscountLimitsBatch(...)` returning a `Map`
>   keyed `${userId}:${categoryId}`, matching the Phase 1 convention.
> - **D5 → accepted as correct-but-temporary.** During the Phase 3 window a user may redeem a
>   still-active fixed-percentage code (e.g. `PRIDE75`) and receive that percentage capped by
>   their allowance. This is acceptable: the dollar cap is the control that matters, and it holds.
>   No special handling. The window closes at Phase 4, when the legacy codes are deactivated.
>   Surface this in the Phase 3 admin-facing notes so whoever enters allowance data understands
>   that rows take effect immediately, not at the flip.

## Decision Rationale

### D1 — Where percentage resolution happens

`uses_user_allowance` codes carry no percentage. Every site that computes an amount from
`discountCode.percentage` needs the resolved value instead.

- **(a)** The resolver returns `percentage`; each caller fetches it before computing the amount,
  then calls `checkSeasonalDiscountLimit` as today. Small change per caller, but the allowance
  is read twice per validation unless the result is threaded through.
- **(b)** Callers pass the *pre-discount price* and the service computes the amount itself,
  returning the final figure. Cleaner contract, larger blast radius — changes the signature all
  four callers use.
- **(c)** Resolver returns both percentage and limit in one object; the caller computes the
  amount and passes the already-resolved object into
  `evaluateSeasonalDiscountLimit` (pure, no second query).

**Recommended: (c).** One database read, no signature change to the pure helper, and it reuses
the Phase 1 split between lookup and arithmetic. State how `checkSeasonalDiscountLimit` relates
to the new resolver — whether it wraps it or is superseded for the allowance path.

### D2 — Refund percentage must come from the original invoice, not the current allowance ⚠️

This is the subtlest correctness issue in the phase.

Today, refunding a discounted registration recomputes the discount from the code's fixed
percentage, which always matches what was originally charged. With allowance-driven codes, the
percentage lives in a mutable row. If an admin changes a member's allowance from 50% to 25%
between registration and refund, recomputing yields a credit note that does not match the
original invoice.

`isRefund` currently bypasses the seasonal cap. For allowance-driven codes it must **also**
bypass percentage re-resolution, deriving the amount from the original
`xero_invoice_line_items` entry instead.

Options: derive from the original line item; or snapshot the resolved percentage onto the line
item at redemption time and read it back. **Recommend the former** — no schema change, and the
line item is already the source of truth for `discount_usage_computed`.

Also confirm: `isRefund` must bypass the *eligibility* check too, not just the cap. Refunding a
member whose allowance was since revoked has to work.

### D3 — Rejection message for gated-ineligible users

A user with no allowance for a gated category must not learn that an allowance exists or what
size it is. "This code isn't available to your account" or similar. **Must not** reuse the
at-limit string, which names both the cap and the category.

Confirm the shape: a distinct `isEligible: false` on the result that Site B translates into
`{ isValid: false, error }`, keeping the Phase 1 pattern where the route owns its own strings.

### D4 — Batch allowance lookup for the alternate list

The captain view resolves limits for many users at once. Phase 1 added
`calculateSeasonalDiscountUsageBatch`; an equivalent is now needed for allowances, or the list
regresses to N queries.

Suggested: `resolveEffectiveDiscountLimitsBatch(supabase, userIds[], categoryId, seasonId)`
returning a `Map` keyed the same way (`${userId}:${categoryId}`, colon-delimited, matching
Phase 1). Note the list may contain codes from different categories, so the key must stay
per-user-per-category.

### D5 — Interaction between allowances and still-active fixed-percentage codes

During the Phase 3 window, admins enter allowances while Financial Aid is still ungated and
PRIDE25/50/75/100 are still live. A user with a 50% / $250 allowance who redeems `PRIDE75` gets
75% (from the fixed code) capped at $250 (from the allowance).

Confirm this is understood and accepted as correct-but-temporary. It follows directly from the
resolution table and needs no special handling — but it should be a deliberate decision rather
than a surprise, and it belongs in the Phase 3 admin-facing notes.

## Resolution Semantics

| `requires_user_allowance` | Allowance row | Effective limit |
|---|---|---|
| `false` | absent | Category defaults — today's behavior |
| `false` | present | Allowance overrides; `NULL` columns inherit |
| `true` | absent | **Not eligible** — code rejected |
| `true` | present | Allowance overrides; `NULL` columns inherit |

`max_discount_amount = 0` is an **eligibility failure**, producing D3's neutral message — not the
at-limit message.

⚠️ This directly contradicts the legacy convention preserved in Phase 1, where a category max of
`0` means *unlimited*. Phase 1 left a comment at that check warning against reuse. Honor it: the
allowance path needs its own zero handling and must not be built on the legacy check.

Proposed result shape:

```ts
interface EffectiveLimit {
  maxAllowed: number | null      // null = unlimited
  percentage: number | null      // resolved for allowance-driven codes
  isEligible: boolean            // false = gated category, no allowance (or zero allowance)
  source: 'user_allowance' | 'category_default' | 'gated_denied'
}
```

## Acceptance Criteria

**Behavior must not change**, since no allowance rows exist and no category is gated:

- Existing suites pass unmodified, including the Phase 1 payment service tests
- Every code path resolves to `source: 'category_default'` in the absence of allowance rows
- `npm run build` and `npx tsc --noEmit` clean

**New coverage:**

- Ungated category, no allowance → category default
- Ungated category, allowance present → allowance wins
- Gated category, no allowance → `isEligible: false`
- Gated category, allowance with `NULL` columns → inherits category defaults
- `max_discount_amount = 0` → ineligible, **not** at-limit
- Allowance percentage overrides `default_percentage`
- Allowance-driven code with no allowance and no category default → resolves safely, never
  applies a null or `NaN` discount
- Refund of an allowance-driven code after the allowance changed → credit note matches the
  original invoice (D2)
- Refund for a user whose allowance was revoked → succeeds
- Batch resolver returns the same values as N single calls

**Manual, after the maintainer applies the migration:**

1. Query `user_discount_allowances` directly — confirm the table, constraints, and indexes exist
   as written, since nothing else will catch a typo
2. Insert one allowance row by hand for a test user; confirm the discount reflects it; delete it
3. Confirm `PRIDE` is present and inactive, and that PRIDE25/50/75/100 still work unchanged
4. Registration checkout, alternate list, and admin refund modal all behave exactly as before

## Walkthrough Review Checklist

- [ ] Migration contains schema only, plus `PRIDE` with `is_active = false`
- [ ] No `requires_user_allowance = true` anywhere in the migration
- [ ] PRIDE25/50/75/100 untouched
- [ ] No Supabase CLI command was run
- [ ] Explicit column selects — no `select('*')` against the new table
- [ ] Allowance zero-handling is separate from the legacy `maxAllowed <= 0` check
- [ ] Ineligible message leaks neither the cap nor the category
- [ ] `isRefund` bypasses eligibility *and* cap, and does not re-resolve percentage
- [ ] Alternate list still issues a bounded number of queries
- [ ] `is_default` and `priority` are written by the migration and read by nothing
- [ ] Existing test files unmodified

## Notes for the Implementer

The most likely failure mode is a resolver that works correctly for the cases it was asked about
and silently returns a null percentage for the case it was not — an allowance-driven code with
neither an allowance nor a category default. That combination is unreachable in production until
Phase 4, which is exactly why it will not be caught by manual testing. Handle it explicitly and
test it.

Second most likely: building allowance zero-handling on top of the legacy `<= 0` check, which
inverts the meaning. `0` means unlimited in the category path and ineligible in the allowance
path. They cannot share a branch.
