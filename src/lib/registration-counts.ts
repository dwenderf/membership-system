import { createClient } from '@/lib/supabase/server'

/**
 * Get current registration counts for multiple categories (includes valid reservations)
 * Counts paid registrations + non-expired processing reservations
 * @param categoryIds Array of registration category IDs  
 * @returns Record mapping category ID to current registration count
 */
export async function getCategoryRegistrationCounts(categoryIds: string[]): Promise<Record<string, number>> {
  const supabase = await createClient()
  const counts: Record<string, number> = {}
  
  for (const categoryId of categoryIds) {
    const { count } = await supabase
      .from('user_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('registration_category_id', categoryId)
      .or('payment_status.eq.paid,and(payment_status.eq.processing,processing_expires_at.gt.' + new Date().toISOString() + ')')
    
    counts[categoryId] = count || 0
  }
  
  return counts
}

/**
 * Get current registration count for a single category (includes valid reservations)
 * Counts paid registrations + non-expired processing reservations
 * @param categoryId Registration category ID
 * @returns Number of current registrations (paid + valid processing)
 */
export async function getSingleCategoryRegistrationCount(categoryId: string): Promise<number> {
  const supabase = await createClient()
  
  const { count } = await supabase
    .from('user_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('registration_category_id', categoryId)
    .or('payment_status.eq.paid,and(payment_status.eq.processing,processing_expires_at.gt.' + new Date().toISOString() + ')')
  
  return count || 0
}