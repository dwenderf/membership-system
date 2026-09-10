import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { emailStagingManager } from '@/lib/email/staging'
import { EMAIL_EVENTS } from '@/lib/email/service'
import { formatDateString } from '@/lib/date-utils'

/**
 * Shared Membership Expiration Reminder Logic
 *
 * Used by both:
 * - The daily cron job (/api/cron/membership-reminders)
 * - The manual admin trigger (/api/admin/membership-reminders/run)
 * - The admin "how many would send" preview (/api/admin/membership-reminders/count)
 *
 * Each threshold is matched against `latest_expiration` with strict equality
 * (not <=), the same trick `sendPreNotifications` in payment-plan-processor.ts
 * uses to avoid a dedup table: a member is only ever emailed on the exact day
 * their membership is 30, 14, 7, or 1 days from expiring, and a day the job
 * doesn't run is simply skipped rather than caught up later.
 */
export const MEMBERSHIP_REMINDER_THRESHOLDS_DAYS = [30, 14, 7, 1] as const

interface ExpiringMembershipRow {
  user_id: string
  membership_id: string
  membership_name: string
  latest_expiration: string
}

export interface ExpiringMembershipMatch extends ExpiringMembershipRow {
  thresholdDays: number
}

export interface MembershipReminderResults {
  remindersSent: number
  errors: string[]
}

/**
 * Add `days` to a YYYY-MM-DD date string and return the result in the same format.
 */
function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().substring(0, 10)
}

/**
 * Find every membership whose `latest_expiration` falls exactly on one of
 * MEMBERSHIP_REMINDER_THRESHOLDS_DAYS days from today. Read-only — used both
 * to actually send reminders and to preview how many would send.
 *
 * @param today - The date to use as "today" (format: YYYY-MM-DD)
 */
export async function findExpiringMemberships(
  today: string
): Promise<{ matches: ExpiringMembershipMatch[]; errors: string[] }> {
  const adminSupabase = createAdminClient()
  const matches: ExpiringMembershipMatch[] = []
  const errors: string[] = []

  for (const thresholdDays of MEMBERSHIP_REMINDER_THRESHOLDS_DAYS) {
    const targetDate = addDays(today, thresholdDays)

    try {
      const { data: expiring, error: queryError } = await adminSupabase
        .from('user_memberships_consolidated')
        .select('user_id, membership_id, membership_name, latest_expiration')
        .eq('latest_expiration', targetDate)

      if (queryError) {
        logger.logBatchProcessing(
          'membership-reminder-query-error',
          `Error querying memberships expiring in ${thresholdDays} days`,
          { thresholdDays, targetDate, error: queryError.message },
          'error'
        )
        errors.push(`Query error (${thresholdDays}d): ${queryError.message}`)
        continue
      }

      for (const row of (expiring || []) as ExpiringMembershipRow[]) {
        matches.push({ ...row, thresholdDays })
      }
    } catch (thresholdError) {
      const errorMessage = thresholdError instanceof Error ? thresholdError.message : String(thresholdError)
      logger.logBatchProcessing(
        'membership-reminder-threshold-error',
        `Unexpected error processing ${thresholdDays}-day reminders`,
        { thresholdDays, targetDate, error: errorMessage },
        'error'
      )
      errors.push(`Threshold ${thresholdDays}d: ${errorMessage}`)
    }
  }

  return { matches, errors }
}

/**
 * Count how many reminder emails would be sent right now, without staging
 * or sending anything. Powers the admin "N emails will be sent" preview.
 *
 * @param today - The date to use as "today" (format: YYYY-MM-DD)
 */
export async function countExpiringMemberships(today: string): Promise<number> {
  const { matches } = await findExpiringMemberships(today)
  return matches.length
}

/**
 * Stage expiration reminder emails for every membership whose `latest_expiration`
 * falls exactly on one of MEMBERSHIP_REMINDER_THRESHOLDS_DAYS days from today.
 *
 * @param today - The date to use as "today" (format: YYYY-MM-DD)
 */
export async function sendExpirationReminders(today: string): Promise<MembershipReminderResults> {
  const adminSupabase = createAdminClient()
  const results: MembershipReminderResults = {
    remindersSent: 0,
    errors: []
  }

  const { matches, errors: queryErrors } = await findExpiringMemberships(today)
  results.errors.push(...queryErrors)

  if (matches.length === 0) {
    return results
  }

  logger.logBatchProcessing(
    'membership-reminder-found',
    `Found ${matches.length} memberships expiring on a reminder threshold`,
    { count: matches.length }
  )

  const userIds = [...new Set(matches.map(m => m.user_id))]
  const { data: users, error: usersError } = await adminSupabase
    .from('users')
    .select('id, email, first_name, last_name')
    .in('id', userIds)

  if (usersError) {
    logger.logBatchProcessing(
      'membership-reminder-users-query-error',
      'Error fetching users for reminders',
      { error: usersError.message },
      'error'
    )
    results.errors.push(`Users query error: ${usersError.message}`)
    return results
  }

  const usersById = new Map((users || []).map(u => [u.id, u]))

  for (const match of matches) {
    const user = usersById.get(match.user_id)
    if (!user) {
      continue
    }

    const userName = `${user.first_name} ${user.last_name}`

    try {
      const staged = await emailStagingManager.stageEmail({
        user_id: match.user_id,
        email_address: user.email,
        event_type: EMAIL_EVENTS.MEMBERSHIP_EXPIRING,
        subject: `Your ${match.membership_name} expires in ${match.thresholdDays} days`,
        template_id: process.env.LOOPS_MEMBERSHIP_EXPIRING_TEMPLATE_ID,
        email_data: {
          user_name: userName,
          membership_name: match.membership_name,
          expiration_date: formatDateString(match.latest_expiration),
          days_until_expiration: match.thresholdDays,
          renew_url: `${process.env.NEXT_PUBLIC_SITE_URL}/user/memberships`,
          // The standard email-footer button component reads this exact
          // (camelCase) key — every template must send it, per AGENTS.md.
          dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user`
        },
        triggered_by: 'automated',
        related_entity_type: 'user_memberships',
        related_entity_id: match.membership_id
      })

      if (staged) {
        results.remindersSent++
      } else {
        results.errors.push(
          `Failed to stage reminder for user ${match.user_id} (${match.thresholdDays}d)`
        )
      }
    } catch (emailError) {
      logger.logBatchProcessing(
        'membership-reminder-stage-error',
        'Failed to stage membership reminder email',
        {
          userId: match.user_id,
          thresholdDays: match.thresholdDays,
          error: emailError instanceof Error ? emailError.message : String(emailError)
        },
        'warn'
      )
    }
  }

  return results
}
