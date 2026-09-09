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
        results.errors.push(`Query error (${thresholdDays}d): ${queryError.message}`)
        continue
      }

      const expiringMemberships = (expiring || []) as ExpiringMembershipRow[]

      if (expiringMemberships.length === 0) {
        continue
      }

      logger.logBatchProcessing(
        'membership-reminder-found',
        `Found ${expiringMemberships.length} memberships expiring in ${thresholdDays} days`,
        { thresholdDays, targetDate, count: expiringMemberships.length }
      )

      const userIds = [...new Set(expiringMemberships.map(m => m.user_id))]
      const { data: users, error: usersError } = await adminSupabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)

      if (usersError) {
        logger.logBatchProcessing(
          'membership-reminder-users-query-error',
          `Error fetching users for ${thresholdDays}-day reminders`,
          { thresholdDays, targetDate, error: usersError.message },
          'error'
        )
        results.errors.push(`Users query error (${thresholdDays}d): ${usersError.message}`)
        continue
      }

      const usersById = new Map((users || []).map(u => [u.id, u]))

      for (const membership of expiringMemberships) {
        const user = usersById.get(membership.user_id)
        if (!user) {
          continue
        }

        const userName = `${user.first_name} ${user.last_name}`

        try {
          const staged = await emailStagingManager.stageEmail({
            user_id: membership.user_id,
            email_address: user.email,
            event_type: EMAIL_EVENTS.MEMBERSHIP_EXPIRING,
            subject: `Your ${membership.membership_name} expires in ${thresholdDays} days`,
            template_id: process.env.LOOPS_MEMBERSHIP_EXPIRING_TEMPLATE_ID,
            email_data: {
              user_name: userName,
              membership_name: membership.membership_name,
              expiration_date: formatDateString(membership.latest_expiration),
              days_until_expiration: thresholdDays,
              renew_url: `${process.env.NEXT_PUBLIC_SITE_URL}/user/memberships`
            },
            triggered_by: 'automated',
            related_entity_type: 'user_memberships',
            related_entity_id: membership.membership_id
          })

          if (staged) {
            results.remindersSent++
          } else {
            results.errors.push(
              `Failed to stage reminder for user ${membership.user_id} (${thresholdDays}d)`
            )
          }
        } catch (emailError) {
          logger.logBatchProcessing(
            'membership-reminder-stage-error',
            'Failed to stage membership reminder email',
            {
              userId: membership.user_id,
              thresholdDays,
              error: emailError instanceof Error ? emailError.message : String(emailError)
            },
            'warn'
          )
        }
      }
    } catch (thresholdError) {
      const errorMessage = thresholdError instanceof Error ? thresholdError.message : String(thresholdError)
      logger.logBatchProcessing(
        'membership-reminder-threshold-error',
        `Unexpected error processing ${thresholdDays}-day reminders`,
        { thresholdDays, targetDate, error: errorMessage },
        'error'
      )
      results.errors.push(`Threshold ${thresholdDays}d: ${errorMessage}`)
    }
  }

  return results
}
