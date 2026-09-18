import { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logging/logger'

/**
 * Records one row in policy_acceptance_logs for a checked "I agree to the
 * Terms and Conditions, Code of Conduct, Concussion Policy, and Privacy
 * Policy" acceptance. Non-fatal: a logging failure is reported but never
 * blocks the purchase/registration/etc. it was recorded alongside.
 */
export async function logPolicyAcceptance(
  adminSupabase: SupabaseClient,
  userId: string,
  source: string
) {
  const { error } = await adminSupabase
    .from('policy_acceptance_logs')
    .insert({ user_id: userId, source })

  if (error) {
    logger.logPaymentProcessing(
      'policy-acceptance-log-failed',
      'Failed to log policy acceptance',
      { userId, source, error: error.message },
      'error'
    )
  }
}
