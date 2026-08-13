/**
 * Deterministic color assignment for arbitrary category names.
 *
 * Registrations can define any number of categories (e.g. "Skater", "Goalie",
 * "Registration", tournament divisions, etc.), so instead of a fixed lookup we
 * hash the category name into a stable index in a fixed palette. The same name
 * always resolves to the same color, everywhere it's rendered.
 */

interface CategoryColorVariant {
  /** Table-cell badge, e.g. "Skater" pill in a roster row */
  pill: string
  /** Selected filter chip */
  chipActive: string
  /** Unselected filter chip */
  chipInactive: string
}

// Hues deliberately avoid purple (LGBTQ+), blue (Ally), green (Goalie status),
// and gray (No / No Response), which already carry meaning on these pages.
const CATEGORY_COLOR_PALETTE: CategoryColorVariant[] = [
  {
    pill: 'bg-indigo-100 text-indigo-800',
    chipActive: 'bg-indigo-600 text-white border-indigo-600',
    chipInactive: 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100',
  },
  {
    pill: 'bg-amber-100 text-amber-800',
    chipActive: 'bg-amber-600 text-white border-amber-600',
    chipInactive: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
  },
  {
    pill: 'bg-rose-100 text-rose-800',
    chipActive: 'bg-rose-600 text-white border-rose-600',
    chipInactive: 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100',
  },
  {
    pill: 'bg-teal-100 text-teal-800',
    chipActive: 'bg-teal-600 text-white border-teal-600',
    chipInactive: 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100',
  },
  {
    pill: 'bg-orange-100 text-orange-800',
    chipActive: 'bg-orange-600 text-white border-orange-600',
    chipInactive: 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100',
  },
  {
    pill: 'bg-cyan-100 text-cyan-800',
    chipActive: 'bg-cyan-600 text-white border-cyan-600',
    chipInactive: 'bg-cyan-50 text-cyan-800 border-cyan-200 hover:bg-cyan-100',
  },
  {
    pill: 'bg-fuchsia-100 text-fuchsia-800',
    chipActive: 'bg-fuchsia-600 text-white border-fuchsia-600',
    chipInactive: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200 hover:bg-fuchsia-100',
  },
  {
    pill: 'bg-lime-100 text-lime-800',
    chipActive: 'bg-lime-600 text-white border-lime-600',
    chipInactive: 'bg-lime-50 text-lime-800 border-lime-200 hover:bg-lime-100',
  },
  {
    pill: 'bg-sky-100 text-sky-800',
    chipActive: 'bg-sky-600 text-white border-sky-600',
    chipInactive: 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
  },
  {
    pill: 'bg-pink-100 text-pink-800',
    chipActive: 'bg-pink-600 text-white border-pink-600',
    chipInactive: 'bg-pink-50 text-pink-800 border-pink-200 hover:bg-pink-100',
  },
]

function hashCategoryName(name: string): number {
  let hash = 5381
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 33) ^ name.charCodeAt(i)
  }
  return Math.abs(hash)
}

/**
 * Get the color variant set for a category name. The same name always maps
 * to the same colors, regardless of what other categories exist.
 */
export function getCategoryColors(name: string): CategoryColorVariant {
  const index = hashCategoryName(name) % CATEGORY_COLOR_PALETTE.length
  return CATEGORY_COLOR_PALETTE[index]
}
