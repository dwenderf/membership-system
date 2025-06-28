import { createClient } from '@/lib/supabase/server'

/**
 * Get paid registration counts for multiple categories
 * @param categoryIds Array of registration category IDs
 * @returns Record mapping category ID to paid registration count
 */
export async function getCategoryRegistrationCounts(categoryIds: string[]): Promise<Record<string, number>> {
  const supabase = await createClient()
  const counts: Record<string, number> = {}
  
  for (const categoryId of categoryIds) {
    const { count } = await supabase
      .from('user_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('registration_category_id', categoryId)
      .eq('payment_status', 'paid')
    
    counts[categoryId] = count || 0
  }
  
  return counts
}

/**
 * Get paid registration count for a single category
 * @param categoryId Registration category ID
 * @returns Number of paid registrations
 */
export async function getSingleCategoryRegistrationCount(categoryId: string): Promise<number> {
  const supabase = await createClient()
  
  const { count } = await supabase
    .from('user_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('registration_category_id', categoryId)
    .eq('payment_status', 'paid')
  
  return count || 0
}