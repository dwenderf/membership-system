'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

export async function addSimpleTestMembership(input: {
  membershipId: string
  months: number
  startDate: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'No user logged in' }
  }

  const { data: actor } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!actor?.is_admin) {
    logger.logAdminAction('add-test-membership', 'Non-admin caller', undefined, user.id, 'error')
    return { ok: false, error: 'Admin only' }
  }

  const { membershipId, months, startDate } = input
  const validFrom = new Date(startDate)
  const validUntil = new Date(validFrom)
  validUntil.setMonth(validUntil.getMonth() + months)

  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('*')
    .eq('id', membershipId)
    .single()

  if (membershipError) {
    logger.logAdminAction('add-test-membership', 'Error fetching membership', { membershipId, error: membershipError.message }, user.id, 'error')
    return { ok: false, error: `Error fetching membership: ${membershipError.message}` }
  }
  if (!membership) {
    logger.logAdminAction('add-test-membership', 'No membership found with id', { membershipId }, user.id, 'error')
    return { ok: false, error: 'No membership found' }
  }

  const amountPaid = months === 12 ? membership.price_annual : membership.price_monthly * months
  const insertData = {
    user_id: user.id,
    membership_id: membershipId,
    valid_from: validFrom.toISOString().split('T')[0],
    valid_until: validUntil.toISOString().split('T')[0],
    months_purchased: months,
    payment_status: 'paid',
    amount_paid: amountPaid,
    purchased_at: new Date().toISOString()
  }

  // authenticated has no INSERT on user_memberships; write with service role.
  const adminSupabase = createAdminClient()
  const { error } = await adminSupabase
    .from('user_memberships')
    .insert(insertData)
    .select()

  if (error) {
    logger.logAdminAction('add-test-membership', 'Error inserting test membership', { membershipId, error: error.message }, user.id, 'error')
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
