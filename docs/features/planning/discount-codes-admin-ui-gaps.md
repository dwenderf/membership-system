# Discount Codes Admin UI Doesn't Support Allowance-Driven Codes

**Status:** 🔴 Open
**Created:** 2026-07-29
**Severity:** Medium — `PRIDE` is currently uneditable through the UI, and saving it would corrupt it
**Origin:** Phase 3 scope gap. The spec covered adding `requires_user_allowance` to the discount **categories** admin and never mentioned the discount **codes** admin, so allowance-driven codes have no UI support at all.
**Related:** [Per-User Discount Allowances](./user-discount-allowances.md)

## Problem 1 — Allowance-driven codes can't be viewed or edited safely

`discount_codes.uses_user_allowance` was added in Phase 2. Codes with this flag carry
`percentage = NULL` and resolve their percentage from `user_discount_allowances` at redemption
time. The codes admin knows nothing about it.

Opening `PRIDE` in `/admin/discount-codes/[id]/edit` today:

- **Discount Percentage is empty and required.** The form cannot be submitted without a value, and
  the submit button stays disabled reading "Complete Form to Update".
- **Entering a value to satisfy the form writes a real percentage where the design intends `NULL`.**
  It would be inert — `resolveDiscountPercentage` checks `uses_user_allowance` first and never reads
  the code's own value — but it is misleading to the next admin, and if anyone later cleared
  `uses_user_allowance` the code would silently begin applying it.
- **The preview reads "% off"** with no number.
- Nothing on the page indicates the code is allowance-driven.

So the page is a trap: it looks broken, and the obvious way to "fix" it corrupts the record.

**Workaround in use:** activate and manage `PRIDE` via direct SQL.

### Required changes

- **Read `uses_user_allowance`** on the edit and new forms.
- **When true:** replace the percentage input with static explanatory text — e.g. "Percentage is
  set per user via discount allowances" — disabled rather than hidden, so it is obvious why the
  field is absent. Skip the required-percentage validation. Never write a percentage for these
  codes; the column must stay `NULL`.
- **When false:** unchanged from today.
- **Preview** should say something like "Per-user allowance" instead of "% off".
- **Codes list** should show the flag, so `PRIDE` is distinguishable from `PRIDE75` at a glance.
- **Creating** an allowance-driven code from the UI is optional. The partial unique index allows at
  most one per category, so if the form offers a `uses_user_allowance` checkbox it must surface that
  constraint violation as a usable message rather than a raw database error. Deferring creation to
  SQL is an acceptable v1.

## Problem 2 — Empty context box on the codes admin

The blue box at the top of the discount code edit page renders with blank values:

```
Category:
Accounting Code:
```

Reported as empty for **all** discount codes, not only `PRIDE`, so this is independent of the null
percentage. The "Back to Category Codes" button also does not navigate anywhere.

The box is worth keeping — category and accounting code are useful context when editing a code —
so populate it rather than remove it:

- Fetch and display the parent category name and its accounting code
- Fix the "Back to Category Codes" link target
- The page header reads "Update discount code for" with a trailing blank; it should name the code
  or the category

## Not in Scope

- Any change to resolution logic. This is UI only.
- `discount_categories.default_percentage`. It remains deliberately absent from the UI (Phase 3,
  decision D1) — nothing reads it, and exposing it would reintroduce the inheritance ambiguity that
  decision removed.
- The "This is a REVENUE account" accounting-code warning on the categories page — pre-existing and
  unrelated.

## Acceptance Criteria

- `PRIDE` opens in the edit form without validation errors and can be saved without writing a
  percentage
- After saving `PRIDE` through the UI, `SELECT percentage FROM discount_codes WHERE code = 'PRIDE'`
  still returns `NULL`
- Fixed-percentage codes behave exactly as they do today, including required-percentage validation
- The codes list distinguishes allowance-driven codes
- The context box shows the real category name and accounting code for every code
- "Back to Category Codes" navigates to that category's codes
- `npx tsc --noEmit` reports no new errors in touched files; `npm run build` passes

## Tests

- Editing an allowance-driven code and saving leaves `percentage` `NULL`
- Editing a fixed-percentage code still requires and persists a percentage
- The form does not submit a percentage field for allowance-driven codes
- Context box renders category name and accounting code for a code whose category has both

## Priority

Not blocking the `PRIDE` pilot — activation is a single SQL statement. But it should land before
anyone else administers discount codes, because opening `PRIDE` in this form and clicking save is
currently a way to quietly break it.
