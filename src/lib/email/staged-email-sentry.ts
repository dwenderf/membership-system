/**
 * Sentry reporting for staged-email send failures (email-sync cron).
 *
 * Why this exists: staged-email failures were only written to the logger, and
 * the logger's generic auto-report (a) put the recipient address into Sentry
 * context, (b) grouped every failure under one generic message, and (c) a
 * Loops 4xx rejection was treated as "transient", so the row stayed 'pending'
 * and failed again on every one-minute cron run (2h of retries on 2026-10-13).
 *
 * Policy (no flooding, no personal data):
 * - Hard failures (Loops rejected the request: 4xx other than 429, or an
 *   unsuccessful response) mark the row 'failed', so they happen exactly once
 *   per email. Each is captured as one Sentry event, fingerprinted by
 *   eventType + failure kind + normalized error, so identical failures collapse
 *   into one issue whose event count = number of emails affected.
 * - Transient failures (network, 5xx, 429) keep the row 'pending' and retry on
 *   the next run, so they are NOT captured per email; one summary warning per
 *   cron run is captured instead.
 * - Tags carry only event type, template id, failure kind and status code;
 *   context carries only the email_logs id. No addresses, names or data vars.
 */

import * as Sentry from '@sentry/nextjs'
import { APIError } from 'loops'

export type StagedEmailFailureKind = 'loops_rejected' | 'loops_unsuccessful' | 'transient'

export interface StagedEmailFailure {
  emailLogId: string
  eventType: string
  templateId: string | null
  kind: StagedEmailFailureKind
  statusCode?: number
  errorMessage: string
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const EMAIL_RE = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g

/** Strip ids/addresses so the message is safe to send and stable for grouping. */
export function normalizeEmailError(message: string): string {
  return message.replace(EMAIL_RE, '<email>').replace(UUID_RE, '<id>').trim().slice(0, 200)
}

/** Loops 4xx (except 429 rate limit) means the request itself is wrong: retrying can't help. */
export function classifyLoopsError(error: unknown): { kind: StagedEmailFailureKind; statusCode?: number } {
  // instanceof plus a duck-typed check, in case the SDK is bundled twice.
  const statusCode =
    error instanceof APIError
      ? error.statusCode
      : typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : undefined
  if (statusCode !== undefined) {
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
      return { kind: 'loops_rejected', statusCode }
    }
    return { kind: 'transient', statusCode }
  }
  return { kind: 'transient' }
}

function sentryEnabled(): boolean {
  return typeof window === 'undefined' && (process.env.NODE_ENV === 'production' || !!process.env.VERCEL)
}

/** One event per hard-failed email (each email hard-fails only once). */
export function reportStagedEmailHardFailure(failure: StagedEmailFailure): boolean {
  if (!sentryEnabled()) return false
  const normalized = normalizeEmailError(failure.errorMessage)
  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setFingerprint(['staged-email-failure', failure.eventType, failure.kind, normalized])
    scope.setTags({
      source: 'email-sync',
      email_event_type: failure.eventType,
      email_template_id: failure.templateId ?? 'none',
      failure_kind: failure.kind,
      loops_status: failure.statusCode !== undefined ? String(failure.statusCode) : 'none',
    })
    scope.setContext('staged_email', { emailLogId: failure.emailLogId })
    Sentry.captureMessage(`Staged email failed (${failure.eventType}): ${normalized}`)
  })
  return true
}

/** One summary warning per cron run for transient (will-retry) failures. */
export function reportTransientFailureSummary(failures: StagedEmailFailure[]): boolean {
  if (!sentryEnabled() || failures.length === 0) return false
  const eventTypes = Array.from(new Set(failures.map((f) => f.eventType))).sort()
  Sentry.withScope((scope) => {
    scope.setLevel('warning')
    scope.setFingerprint(['staged-email-transient', ...eventTypes])
    scope.setTags({ source: 'email-sync', failure_kind: 'transient' })
    scope.setContext('staged_email_run', {
      count: failures.length,
      eventTypes,
      errors: Array.from(new Set(failures.map((f) => normalizeEmailError(f.errorMessage)))).slice(0, 10),
      emailLogIds: failures.map((f) => f.emailLogId).slice(0, 50),
    })
    Sentry.captureMessage(`Staged email transient failures this run: ${failures.length} (${eventTypes.join(', ')})`)
  })
  return true
}

/** Await delivery: the cron handler returns right after, and Vercel then freezes. */
export async function flushStagedEmailReports(): Promise<void> {
  try {
    await Sentry.flush(2000)
  } catch {
    // never let reporting break the cron
  }
}
