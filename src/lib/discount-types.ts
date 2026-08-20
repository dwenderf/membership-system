/**
 * Discount Category/Code Types
 *
 * `discount_categories` and `discount_codes` aren't in the generated Supabase
 * types (src/types/database.ts), so their row shapes are maintained here by
 * hand, matching supabase/schema.sql and supabase/migrations/2026-07-27-add-user-discount-allowances.sql.
 */

export interface DiscountCategoryRow {
  id: string
  name: string
  accounting_code: string
  max_discount_per_user_per_season: number | null
  is_active: boolean
  description: string | null
  requires_user_allowance: boolean
  default_percentage: number | null
  priority: number
  created_at: string
}

export interface DiscountCodeRow {
  id: string
  discount_category_id: string
  code: string
  percentage: number | null
  is_active: boolean
  valid_from: string | null
  valid_until: string | null
  uses_user_allowance: boolean
  created_at: string
}

/**
 * `discount_codes` joined to its parent `discount_categories` row via
 * `.select('*, discount_categories(...)')`. Supabase's inferred join
 * cardinality varies, so callers already defensively unwrap this with
 * `Array.isArray(...)` — keep that pattern rather than "fixing" it away.
 */
export type DiscountCodeWithCategoryJoin<TCategory> = DiscountCodeRow & {
  discount_categories: TCategory | TCategory[] | null
}
