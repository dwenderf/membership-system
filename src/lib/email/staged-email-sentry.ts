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
 * - Loops setup errors (401/403/404/408, template/domain 400s) keep the row
 *   'pending' and raise one throttled alert per run.
 * - Transient failures (network, 5xx, 429) keep the row 'pending' and retry on
 *   the next run; one throttled summary warning is captured instead.
 * - Tags carry only event type, template id, failure kind and status code;
 *   context carries only the email_logs id. No addresses, names or data vars.
 */

import * as Sentry from '@sentry/nextjs'
import { APIError } from 'loops'

export type StagedEmailFailureKind =
  | 'loops_rejected' // per-email data error: permanent ('failed')
  | 'loops_unsuccessful' // 200 with success:false: permanent ('failed')
  | 'loops_config' // account/template/domain setup error: stays 'pending', alerts (throttled)
  | 'transient' // network, 5xx, 429: stays 'pending', summary (throttled)

/** Kinds that keep the row 'pending' so it is retried once the cause is fixed. */
export const isRetryableKind = (kind: StagedEmailFailureKind): boolean =>
  kind === 'transient' || kind === 'loops_config'

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

// 400s that describe Loops account/template/sender setup rather than this
// email's data. Once fixed in Loops, the same payload sends fine.
const CONFIG_400_RE =
  /not published|unpublished|transactional(?: email)? (?:id )?(?:not found|is archived|archived|does not exist)|invalid transactional|template|domain|sender|from address|not verified|unverified|api key|sending is (?:disabled|paused)|account/i
// 401 bad/rotated API key, 403 forbidden/suspended, 404 unknown template id,
// 408 request timeout.
const CONFIG_STATUSES = new Set([401, 403, 404, 408])

/**
 * Classify a thrown Loops send error.
 * - setup errors (401/403/404/408, config-shaped 400s): 'loops_config', retryable + alert
 * - other 4xx except 429 (e.g. "Missing required data variable(s)"): 'loops_rejected', permanent
 * - 429, 5xx, network, no status: 'transient'
 */
export function classifyLoopsError(error: unknown): { kind: StagedEmailFailureKind; statusCode?: number } {
  // instanceof plus a duck-typed check, in case the SDK is bundled twice.
  const statusCode =
    error instanceof APIError
      ? error.statusCode
      : typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : undefined
  if (statusCode === undefined) return { kind: 'transient' }
  if (statusCode === 429 || statusCode >= 500 || statusCode < 400) return { kind: 'transient', statusCode }
  if (CONFIG_STATUSES.has(statusCode)) return { kind: 'loops_config', statusCode }
  const message = error instanceof Error ? error.message : String(error)
  if (statusCode === 400 && !/missing required data variable/i.test(message) && CONFIG_400_RE.test(message)) {
    return { kind: 'loops_config', statusCode }
  }
  return { kind: 'loops_rejected', statusCode }
}

function sentryEnabled(): boolean {
  return (
    typeof window === 'undefined' &&
    !!process.env.NEXT_PUBLIC_SENTRY_DSN &&
    (process.env.NODE_ENV === 'production' || !!process.env.VERCEL)
  )
}

// Per-instance throttle for alerts that repeat on every one-minute cron run
// while the cause persists (Loops setup errors, outages). Warm Vercel instances
// are reused across runs, so this caps it at roughly one event per window per
// instance; Sentry also groups them into one issue by fingerprint.
export const ALERT_THROTTLE_MS = 15 * 60 * 1000
const lastAlertAt = new Map<string, number>()
function shouldAlert(key: string, now: number = Date.now()): boolean {
  const last = lastAlertAt.get(key)
  if (last !== undefined && now - last < ALERT_THROTTLE_MS) return false
  lastAlertAt.set(key, now)
  return true
}
/** Test helper. */
export function resetAlertThrottle(): void {
  lastAlertAt.clear()
}

/** One throttled alert per run for Loops setup errors (rows stay pending). */
export function reportLoopsConfigFailures(failures: StagedEmailFailure[]): boolean {
  if (!sentryEnabled() || failures.length === 0) return false
  const statuses = Array.from(new Set(failures.map((f) => String(f.statusCode ?? 'none')))).sort()
  if (!shouldAlert(`config:${statuses.join(',')}`)) return false
  const errors = Array.from(new Set(failures.map((f) => normalizeEmailError(f.errorMessage)))).slice(0, 10)
  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setFingerprint(['staged-email-loops-config', ...statuses])
    scope.setTags({ source: 'email-sync', failure_kind: 'loops_config', loops_status: statuses.join(',') })
    scope.setContext('staged_email_run', {
      count: failures.length,
      eventTypes: Array.from(new Set(failures.map((f) => f.eventType))).sort(),
      templateIds: Array.from(new Set(failures.map((f) => f.templateId ?? 'none'))).sort(),
      errors,
      note: 'Emails left pending and will send automatically once the Loops setup is fixed.',
    })
    Sentry.captureMessage(`Loops setup error blocking staged emails (${statuses.join(', ')}): ${errors[0] ?? ''}`)
  })
  return true
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
  if (!shouldAlert(`transient:${eventTypes.join(',')}`)) return false
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
