# Allowance Percentage Is Resolved Inconsistently Across Call Sites

**Status:** 🔴 Open — blocks Phase 3
**Created:** 2026-07-27
**Severity:** High once allowance rows exist. Unreachable today.
**Origin:** Unfinished Phase 2 work. The Phase 2 plan listed both payment services under "resolve effective percentage for allowance-driven codes"; the walkthrough reported them as done and they were not.
**Related:** [Per-User Discount Allowances](./user-discount-allowances.md), [Phase 2](./discount-allowances-phase-2-resolver.md)

## Summary

Four call sites compute a discount amount from a percentage. Only one of them —
`validate-discount-code` — resolves that percentage correctly. The other three each get it wrong,
in two different ways, and they disagree with each other.

Nothing can reach this today: `PRIDE` is inactive, no category is gated, and
`user_discount_allowances` is empty in production. **It activates the moment an admin saves the
first allowance row**, which is exactly what Phase 3 ships.

## The Rule

Established in Phase 2 and implemented correctly in `validate-discount-code`:

```ts
const pct = discountCode.uses_user_allowance
  ? effectiveLimit.percentage                    // allowance-driven: resolved from allowance
  : parseFloat(String(discountCode.percentage))  // fixed code: its own percentage, always
```

The allowance's **dollar cap** applies to every code in the category. The allowance's
**percentage** applies only to allowance-driven codes. A member with a 50% / $250 allowance
redeeming `PRIDE75` gets 75%, capped at $250 — decision D5.

## Call Sites

| Site | Resolves percentage | Status |
|---|---|---|
| `src/app/api/validate-discount-code/route.ts` | Branches on `uses_user_allowance` | ✅ Correct |
| `src/app/api/alternate-registrations/[gameId]/alternates/route.ts` | Allowance percentage overrides everything | ❌ Wrong |
| `src/lib/services/alternate-payment-service.ts` | Never consults the allowance | ❌ Wrong |
| `src/lib/services/waitlist-payment-service.ts` | Unverified — expected same as above | ⚠️ Check |

### Alternates route — allowance overrides fixed codes

```ts
const effectivePercentage = effectiveLimit?.percentage
  ?? (discountCode.percentage != null ? parseFloat(String(discountCode.percentage)) : null)
```

No `uses_user_allowance` branch. When an allowance row exists, its percentage wins for *every*
code in the category, including fixed ones. The `discountCode.percentage` returned in the response
is the raw code value, so the displayed percentage may match neither what was computed nor what
will be charged.

### Alternate payment service — allowance ignored entirely

```ts
const rawPct = discount.percentage ?? discount.category?.default_percentage
const pct = rawPct != null ? parseFloat(String(rawPct)) : 0
let requestedDiscountAmount = Math.round((basePrice * pct) / 100)
```

For fixed codes this happens to be correct — the code's own percentage is used, and
`checkSeasonalDiscountLimit` still applies the allowance's dollar cap downstream.

For allowance-driven codes it resolves to `0` (`PRIDE` has a null percentage and Financial Aid has
no `default_percentage`). `requestedDiscountAmount` is then `0`, which fails the `> 0` guard, so
`checkSeasonalDiscountLimit` is never called and no discount is applied at all.

## Why This Blocks Phase 3

Phase 3 delivers the admin UI that creates allowance rows. With the current code, a member holding
a 50% allowance who registered as an alternate with `PRIDE75` produces:

| | Percentage used | Result |
|---|---|---|
| Captain's alternate list | 50% (allowance) | Displays one discount |
| Charge at selection | 75% (code) | Charges a different one |

Both wrong, and they disagree — the display/charge divergence Phase 1 existed to eliminate,
reappearing in the one flow that was never manually exercised.

At Phase 4, when `PRIDE` activates, the payment services degrade further: alternates and waitlist
promotions using `PRIDE` are charged **full price** while the list shows a discount.

## Proposed Fix

Add a shared helper to `discount-limit-service.ts` so the decision exists once:

```ts
export function resolveDiscountPercentage(
  discountCode: { percentage?: number | string | null; uses_user_allowance?: boolean | null },
  effectiveLimit: EffectiveLimit | undefined
): number | null
```

Returns `effectiveLimit.percentage` when `uses_user_allowance` is true, the code's own parsed
percentage otherwise, and `null` when unresolvable. All four call sites use it — including
`validate-discount-code`, which is correct today but should not keep its own copy.

Four independent implementations of one decision is how these diverged. Do not fix them
independently.

Per site:

- **Alternates route** — use the helper; return the effective percentage in the response rather
  than the raw code value
- **Alternate payment service** — call `resolveEffectiveDiscountLimits`, use the helper, and check
  `isEligible` before applying any discount. Re-examine the `requestedDiscountAmount > 0` guard so
  a legitimately resolved percentage is never silently skipped
- **Waitlist payment service** — verify first, then the same treatment
- **validate-discount-code** — swap its inline branch for the helper; no behavior change

Consider also adding an option to `checkSeasonalDiscountLimit` accepting a pre-resolved
`EffectiveLimit`, mirroring the existing pre-fetched `discountCode` option. Callers currently
resolve, then the service resolves again — two identical lookups per validation.

## Acceptance Criteria

- [ ] One shared helper; no call site computes a percentage independently
- [ ] Fixed-percentage codes always use their own percentage, regardless of any allowance
- [ ] Allowance-driven codes always use the resolved allowance percentage
- [ ] The dollar cap still applies to every code in the category, both kinds
- [ ] Ineligible users receive no discount on every path, not just checkout
- [ ] The alternates list and the alternate charge agree, for both code kinds
- [ ] Waitlist verified and consistent with the other three
- [ ] Existing payment service test suites pass **unmodified**

## Tests

- Fixed code + allowance present → code's percentage, allowance's cap (the D5 case)
- Allowance-driven code + allowance present → allowance's percentage and cap
- Allowance-driven code + no allowance + no category default → no discount, no `NaN`, on every path
- Gated category + no allowance → no discount on every path
- **Cross-path consistency:** same user, same code, same registration — the alternates list
  discount equals the amount `AlternatePaymentService` charges. This is the assertion that would
  have caught the divergence and none of the current suites make it.

## Sequencing

Fix **before Phase 3**, as its own PR. Not bundled:

- Phase 3 is what makes the bug reachable, so it cannot ship first
- Phase 4 must stay three SQL statements to keep its one-click revert

Production is currently safe and can stay as it is indefinitely.
