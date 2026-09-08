import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { logger } from '@/lib/logging/logger'

/**
 * Shared auth guard for /api/cron/* routes, called by Vercel Cron with
 * `Authorization: Bearer $CRON_SECRET`.
 *
 * Replaces five inconsistent inline checks (see issue #287): two failed open
 * when CRON_SECRET was unset (`if (cronSecret && authHeader !== ...)` skips
 * the check entirely rather than rejecting), two built the comparison target
 * with a template literal (`` `Bearer ${process.env.CRON_SECRET}` ``), which
 * with the var unset becomes the literal string "Bearer undefined" and
 * authenticates any caller who sends that, and all five compared with `!==`
 * instead of a constant-time comparison. Mirrors the EXPORT_API_SECRET guard
 * in src/app/api/admin/exports/members/route.ts.
 */

/**
 * Constant-time comparison so the secret can't be recovered by timing the
 * response. Lengths are compared first because timingSafeEqual throws on a
 * length mismatch — that leak is acceptable, the secret's contents are not.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Verifies a cron request's bearer token. Returns a response to send
 * immediately when unauthorized/misconfigured, or null when the request is
 * authorized and the route should proceed.
 */
export function authorizeCronRequest(
  request: NextRequest,
  routeName: string
): NextResponse | null {
  const expected = process.env.CRON_SECRET

  // Fail closed. A missing secret must never mean "no authentication required".
  if (!expected) {
    logger.logSystem(
      'cron-auth-misconfigured',
      `CRON_SECRET is not set; refusing to run ${routeName}`,
      { route: routeName },
      'error'
    )
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!token || !secretMatches(token, expected)) {
    logger.logSystem(
      'cron-auth-unauthorized',
      `Rejected an unauthorized ${routeName} cron request`,
      {
        route: routeName,
        // Never log the presented token itself.
        hadAuthorizationHeader: header.length > 0,
      },
      'warn'
    )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
