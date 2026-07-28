# Phase 1 — Consolidate Discount Limit Enforcement

**Status:** 📋 Ready for implementation
**Created:** 2026-07-27
**Parent spec:** [Per-User Discount Allowances](./user-discount-allowances.md)
**PR scope:** Standalone. Must merge before the allowances migration runs.

## Purpose

Seasonal discount cap logic currently exists in three independent implementations. Phase 2
introduces per-user allowances by extending `discount-limit-service.ts`; if the other two
implementations still read `discount_categories.max_discount_per_user_per_season` directly at
that point, they become gatekeeping bypasses — including on the main registration checkout path.

This PR consolidates all three onto the service. **It is a refactor. No user-visible behavior
should change.**

## Non-Goals

Explicitly out of scope — do not implement any of the following in this PR:

- Allowances, gatekeeping, or any per-user limit concept
- Schema changes of any kind
- New columns, tables, migrations, or RLS policies
- Changes to discount percentages, accounting codes, or Xero staging
- Improvements to the logic, beyond what reconciliation requires

If the implementation plan proposes any of these, reject it.

## Current State

> **Verify each of the following against the repository before planning.** This section was
> assembled from code review and may be stale or incomplete. Discrepancies are findings, not
> obstacles — report them.

### Site A — `src/lib/services/discount-limit-service.ts` (canonical)

The target. Exports:

```ts
calculateSeasonalDiscountUsage(supabase, userId, categoryId, seasonId): Promise<number>
checkSeasonalDiscountLimit(supabase, userId, discountCodeId, seasonId, requestedDiscountAmount)
  : Promise<DiscountLimitResult>
```

`DiscountLimitResult` = `{ originalAmount, finalAmount, isPartialDiscount, partialDiscountMessage?, seasonalUsage? }`.

Usage is read from the `discount_usage_computed` view. Consumers today are
`AlternatePaymentService` and `WaitlistPaymentService`.

Behavior at the cap: returns `finalAmount: 0` with an explanatory message. **It does not signal
an error** — the caller decides what to do with a zero discount.

### Site B — `src/app/api/validate-discount-code/route.ts`

Reimplements the cap check inline. Powers the main registration checkout and the admin refund
modal. Known divergences from Site A:

| Behavior | Site A | Site B |
|---|---|---|
| User is at/over the cap | `finalAmount: 0`, no error | **`isValid: false`** — hard rejection with an error string |
| Message wording | Service-specific phrasing | Different phrasing |
| Per-code `usage_limit` | Checked by callers *before* the seasonal check | Appears not to be checked at all — **verify** |
| Refunds | No concept of refunds | `isRefund` flag bypasses cap enforcement entirely |

The at-the-cap divergence is the significant one: Site B rejects the whole code, Site A returns a
zero discount. These produce materially different user experiences and cannot both be preserved
by a single call. See [Decisions Required](#decisions-required).

### Site C — `src/app/api/alternate-registrations/[gameId]/alternates/route.ts`

A third inline copy driving the captain-facing alternate preview list. Builds a
`usageByUserAndCategory` map and computes, per alternate, `isOverLimit`, a capped
`discountAmount`, and a `usageStatus` object. Never rejects — it only caps, since it is a
display path.

**This site is a list, not a single user.** It processes every alternate for a game. The service
signature is per-user, so a naive call-in-a-loop introduces an N+1 query. See
[Decisions Required](#decisions-required).

### Also Affected

`src/app/api/admin/reports/discount-usage/route.ts` computes `remaining` and `isFullyUtilized`
from `category.maxPerUser`. It is **out of scope for this PR** (Phase 5) because per-user limits
do not exist yet and the report is correct today. Do not modify it. Note it in the PR description
so it is not forgotten.

## Decisions Required

The implementation plan must state a position on each of these before writing code. They are the
places where a mechanical consolidation silently changes behavior.

### D1 — Refund handling (`isRefund`)

Site B deliberately bypasses cap enforcement when `isRefund: true`, on the reasoning that a
refund returns allowance rather than consuming it. Site A has no equivalent.

Options:

- **(a)** Add an `isRefund?: boolean` option to `checkSeasonalDiscountLimit`, which short-circuits
  and returns the full requested amount. Preserves behavior exactly.
- **(b)** Keep the refund branch in the route, calling the service only on the non-refund path.
  Preserves behavior, leaves a small amount of logic outside the service.

**Recommended: (a).** The service becomes the single place that knows the rule. But (b) is
acceptable if (a) makes the signature awkward. What is *not* acceptable is dropping the branch —
that would start enforcing caps on refunds, which would break the admin refund modal for any
user at their seasonal limit.

### D2 — At-the-cap semantics

Site A returns a zero discount; Site B rejects the code outright. Pick one and apply it
consistently:

- **(a)** Service gains a discriminator (e.g. `isAtLimit: boolean`) and each caller keeps its
  current presentation — Site B still returns `isValid: false`, Site A's callers still see
  `finalAmount: 0`. **No user-visible change.**
- **(b)** Unify on one behavior. **This changes user-visible behavior** and violates the goal of
  this PR.

**Recommended: (a).** Reconciling the UX is a legitimate discussion, but not in a refactor PR
that is meant to be verifiable by "the existing tests still pass."

### D3 — Batch usage lookup for Site C

Site C needs usage for many users at once. Options:

- **(a)** Add `calculateSeasonalDiscountUsageBatch(supabase, userIds[], categoryId, seasonId)`
  returning a `Map<userId, number>`, and have Site C build its display logic on top of it.
- **(b)** Call the per-user function in a loop.

**Recommended: (a).** (b) is an N+1 against a view that joins six tables, on a path that renders
a full alternate list. Note that Site C is a *display* path — it may only need the usage figure
and the cap, not the full `checkSeasonalDiscountLimit` result.

### D4 — Redundant code fetch

`checkSeasonalDiscountLimit` takes a `discountCodeId` and fetches the code record itself. Site B
has already fetched that record by the time it would call the service. Either accept the extra
query for now (simplest, and this is not a hot path) or add an overload accepting a pre-fetched
code. State which, and why.

## Target End State

- `discount-limit-service.ts` is the only module that reads
  `discount_categories.max_discount_per_user_per_season` or queries `discount_usage_computed`
  for enforcement purposes.
- Sites B and C contain no cap arithmetic — they call the service and present the result.
- Per-code `usage_limit` checks continue to run *before* seasonal cap checks wherever they run
  today. This ordering is asserted by existing tests; do not change it.
- All user-facing message strings are byte-identical to today's, unless D2 is resolved
  otherwise and the change is called out explicitly in the PR description.

## Acceptance Criteria

**Primary: the existing jest suite passes unchanged.** Do not modify these files to make them
pass — if they fail, the refactor changed behavior:

- `src/__tests__/services/alternate-payment-service.test.ts`
- `src/__tests__/services/waitlist-payment-service.test.ts`

These already assert the seasonal-cap semantics, the partial-discount path, and the
per-code-limit-before-seasonal-check ordering. They are the contract.

**Additional:**

- New unit tests covering Sites B and C going through the service, since neither has direct
  coverage today
- If D1 resolves to (a): a test that `isRefund: true` bypasses the cap
- If D3 resolves to (a): a test that the batch function returns the same totals as N individual
  calls
- `npm run build` and typecheck clean
- No new queries introduced on the alternate list path — confirm query count is unchanged or
  lower

**Manual verification:**

1. Registration checkout with a valid code → discount applies as before
2. Registration checkout by a user at their seasonal cap → same message as before the change
3. Registration checkout by a user near the cap → same partial-discount message and amount
4. Alternate list as a captain → same discount amounts and over-limit flags as before
5. Admin refund modal with a discount code for a user at their cap → still works (this is the
   D1 regression case)

## Walkthrough Review Checklist

For reviewing the agent's output before merge. The walkthrough is a self-report; read the diff.

- [ ] No schema files, migrations, or new columns in the diff
- [ ] `max_discount_per_user_per_season` appears in exactly one source file
- [ ] `discount_usage_computed` is queried for enforcement in exactly one source file
- [ ] No user-facing string changed, or each change is listed explicitly
- [ ] The `isRefund` branch still exists somewhere and is exercised by a test
- [ ] Existing test files are unmodified
- [ ] Site C did not gain a per-user query inside a loop
- [ ] Per-code `usage_limit` still evaluated before seasonal caps

## Notes for the Implementer

The most likely failure mode is a walkthrough that reads "consolidated duplicated discount limit
logic into the shared service" while having quietly dropped the refund branch or flipped the
at-the-cap behavior. Both are invisible in a summary and obvious in a diff. D1 and D2 exist
precisely because those two branches do not survive mechanical deduplication.
