# Copilot Instructions for AI Agents

## Project Overview

- **Purpose:** Membership and registration system for adult hockey associations.
- **Tech Stack:** Next.js (frontend), Supabase (database/auth), Stripe (payments), Loops.so (emails), Xero (accounting).
- **Major Components:**
  - `src/app/`: Next.js app structure (pages, components, contexts, config, lib, types)
  - `supabase/`: SQL schema, migrations, and database logic
  - `scripts/`: Utility scripts for dev, admin, and debugging
  - `logs/`: Structured logs for batch, payment, service, and sync processes

## Key Architectural Patterns

- **Financial Data Flow:**
  - All financial transactions are tracked in `xero_invoice_line_items` (see Supabase schema)
  - Categorized by `line_item_type`: `membership`, `registration`, `discount`, `donation`
  - Reporting is driven by the `reports_financial_data` view (only authorized invoices, completed payments)
- **Discounts & Scholarships:**
  - Discount codes are grouped by category (e.g., PRIDE, Board Member)
  - Usage limits and accounting codes are enforced per category/season
- **Authentication:**
  - Passwordless (magic link) and Google OAuth via Supabase
- **Email:**
  - Transactional emails sent via Loops.so
- **Accounting:**
  - Xero integration for invoices and payments

## Developer Workflows

- **Scripts:**
  - Run dev/test/admin scripts from `scripts/` (see `scripts/README.md` for usage)
    - Example: `cd scripts/tests; node test-payment-processor.js`
    - Example: `cd scripts/debug; node debug-registrations.js`
    - Example: `cd scripts/admin; node apply-rls-fix.js`
- **Database:**
  - SQL schema and migrations in `supabase/`
  - RLS (Row Level Security) policies managed via scripts in `scripts/admin/`
- **Logs:**
  - Review logs in `logs/` for batch, payment, service, and sync events

## Project-Specific Conventions

- **Financial reporting relies on strict line item categorization.**
- **Discounts must have `discount_code_id` populated for reporting.**
- **Donations can be positive (received) or negative (given/assistance).**
- **All reporting excludes DRAFT invoices and incomplete payments.**

## Integration Points

- **Stripe:** Payment processing and intent management
- **Supabase:** Auth, database, RLS
- **Loops.so:** Email delivery
- **Xero:** Invoice and payment sync

## Examples

- **Financial line item:**
  - Membership: `{ line_item_type: 'membership', amount: 100 }`
  - Discount: `{ line_item_type: 'discount', amount: -25, discount_code_id: 123 }`
- **Script usage:**
  - `node scripts/tests/test-payment-processor.js`
  - `node scripts/admin/apply-rls-fix.js`

## References

- See `README.md` and `scripts/README.md` for more details and examples.
- Key SQL logic: `supabase/schema.sql`, `supabase/migrations/`
- Admin/debug scripts: `scripts/admin/`, `scripts/debug/`, `scripts/tests/`

---
**Feedback:** If any section is unclear or missing, please specify which workflows, conventions, or architectural details need further documentation.
