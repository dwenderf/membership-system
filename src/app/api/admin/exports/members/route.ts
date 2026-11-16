import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'

/**
 * Authenticated member export for external consumers (spreadsheets, etc.).
 *
 * Replaces three SECURITY DEFINER functions — get_users_data(), get_full_data()
 * and get_current_data() — that were created directly in the database and
 * granted to `anon`. Supabase publishes anything in the `public` schema through
 * PostgREST, so those were readable by anyone holding the (public) anon key:
 * every member's name, email and member_id, with RLS bypassed. See
 * supabase/migrations/20260907000002_revoke_public_function_access.sql.
 *
 * The rule this route exists to demonstrate: data leaves this system through an
 * authenticated API route, never through a public view or RPC.
 *
 *   GET /api/admin/exports/members
 *   Authorization: Bearer $EXPORT_API_SECRET
 *
 * One dataset, `users`: one row per onboarded, non-deleted user. Users who have
 * not finished onboarding (onboarding_completed_at is null) and soft-deleted
 * users (their name and email are obfuscated) are never returned.
 *
 * Query parameters:
 *   dataset            'users' (default; the only value)
 *   membership_status  comma-separated list of 'current', 'expired', 'never'
 *                      (default: 'current'). Each row carries its own
 *                      membership_status, computed from valid_until:
 *                        current  valid_until is today or later (in
 *                                 NEXT_PUBLIC_APP_TIMEZONE)
 *                        expired  has memberships, but every one has lapsed
 *                        never    has no memberships (valid_until is null)
 *   membership_id      uuid; consider only memberships of this type. valid_until
 *                      and membership_status are then relative to that type, so
 *                      a user holding only other types reads as 'never'.
 *   format             'json' (default) or 'csv'
 *
 * valid_until is the latest valid_until among the memberships considered,
 * expired or not, and null when there are none.
 */

// PostgREST caps a single response; page through rather than silently truncating.
const PAGE_SIZE = 1000
const MAX_ROWS = 50000

const MEMBERSHIP_STATUSES = ['current', 'expired', 'never'] as const
type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]

// Parameters from the earlier members/memberships datasets. Rejected rather
// than ignored, so a caller still sending one fails loudly instead of quietly
// receiving a different set of rows.
const REMOVED_PARAMS = ['include_expired', 'include_deleted', 'paid_only']

interface UserRow {
  user_id: string
  member_id: number | null
  first_name: string
  last_name: string
  email: string
  membership_status: MembershipStatus
  valid_until: string | null
  onboarding_completed_at: string
}

/**
 * Today's calendar date (YYYY-MM-DD) in the organization's timezone.
 * valid_until is a DATE, so comparing it to the UTC date would drop memberships
 * that expire today for the last few hours of the local day.
 */
function todayInAppTimezone(now: Date = new Date()): string {
  const timeZone = process.env.NEXT_PUBLIC_APP_TIMEZONE || 'America/New_York'
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

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

function authorize(request: NextRequest): NextResponse | null {
  const expected = process.env.EXPORT_API_SECRET

  // Fail closed. A missing secret must never mean "no authentication required".
  if (!expected) {
    logger.logAdminAction(
      'export-members-misconfigured',
      'EXPORT_API_SECRET is not set; refusing to serve the member export',
      undefined,
      undefined,
      'error'
    )
    return NextResponse.json(
      { error: 'Export endpoint is not configured' },
      { status: 503 }
    )
  }

  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!token || !secretMatches(token, expected)) {
    logger.logAdminAction(
      'export-members-unauthorized',
      'Rejected an unauthenticated member export request',
      {
        // Never log the presented token itself.
        hadAuthorizationHeader: header.length > 0,
        userAgent: request.headers.get('user-agent'),
      },
      undefined,
      'warn'
    )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

function toCsv(rows: ReadonlyArray<UserRow>): string {
  if (rows.length === 0) return ''
  // Rows are flat string/number/null records; index them dynamically.
  const asRecord = (row: UserRow) => row as unknown as Record<string, unknown>
  const columns = Object.keys(asRecord(rows[0]))
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const text = String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((c) => escape(asRecord(row)[c])).join(',')),
  ].join('\n')
}

function parseMembershipStatuses(raw: string | null): MembershipStatus[] | null {
  const parts = (raw ?? 'current').split(',').map((p) => p.trim())
  const valid = parts.every((p) => (MEMBERSHIP_STATUSES as readonly string[]).includes(p))
  if (!valid) return null
  return [...new Set(parts)] as MembershipStatus[]
}

export async function GET(request: NextRequest) {
  const denied = authorize(request)
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const dataset = searchParams.get('dataset') ?? 'users'
  const membershipId = searchParams.get('membership_id')
  const format = searchParams.get('format') ?? 'json'

  const removed = REMOVED_PARAMS.filter((name) => searchParams.has(name))
  if (removed.length > 0) {
    return NextResponse.json(
      {
        error: `${removed.join(', ')} no longer supported; filter with membership_status instead`,
      },
      { status: 400 }
    )
  }
  if (dataset !== 'users') {
    return NextResponse.json({ error: "dataset must be 'users'" }, { status: 400 })
  }
  const statuses = parseMembershipStatuses(searchParams.get('membership_status'))
  if (!statuses) {
    return NextResponse.json(
      { error: "membership_status must be a comma-separated list of 'current', 'expired', 'never'" },
      { status: 400 }
    )
  }
  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json(
      { error: "format must be 'json' or 'csv'" },
      { status: 400 }
    )
  }
  if (
    membershipId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(membershipId)
  ) {
    return NextResponse.json(
      { error: 'membership_id must be a uuid' },
      { status: 400 }
    )
  }

  // Service role: this route does its own authentication above, and the export
  // is deliberately cross-member, which every RLS policy correctly forbids.
  const supabase = createAdminClient()

  try {
    const rows = await fetchUsers(supabase, { membershipId, statuses })

    logger.logAdminAction(
      'export-members',
      `Served ${rows.length} row(s) from the member export`,
      { dataset, membershipId, statuses, format },
      undefined,
      'info'
    )

    if (format === 'csv') {
      return new NextResponse(toCsv(rows), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })
    }

    return NextResponse.json(
      { dataset, count: rows.length, rows },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.logAdminAction(
      'export-members-failed',
      'Member export failed',
      { dataset, error: message },
      undefined,
      'error'
    )
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

type AdminClient = ReturnType<typeof createAdminClient>

interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

/**
 * Reads every page of a query. Throws instead of returning a list silently cut
 * at MAX_ROWS: a truncated export looks complete to the spreadsheet reading it.
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) return rows
    rows.push(...data)
    if (data.length < PAGE_SIZE) return rows
  }
  throw new Error(`Export exceeds ${MAX_ROWS} rows; refusing to return a truncated list`)
}

async function fetchUsers(
  supabase: AdminClient,
  options: { membershipId: string | null; statuses: MembershipStatus[] }
): Promise<UserRow[]> {
  const today = todayInAppTimezone()

  interface UserRecord {
    id: string
    member_id: number | null
    first_name: string
    last_name: string
    email: string
    onboarding_completed_at: string
  }

  // Onboarded, live users only. Order must be total, not just useful: .range()
  // is OFFSET/LIMIT, and PostgreSQL gives no row order without ORDER BY, so
  // pages of an unordered query can overlap or skip rows. member_id is UNIQUE
  // but nullable, which leaves ties among NULLs -- id (the primary key) breaks
  // them. This is also the output order.
  const users = await fetchAllPages<UserRecord>((from, to) =>
    supabase
      .from('users')
      .select('id, member_id, first_name, last_name, email, onboarding_completed_at')
      .not('onboarding_completed_at', 'is', null)
      .is('deleted_at', null)
      .order('member_id', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
      .overrideTypes<UserRecord[], { merge: false }>()
  )

  // Latest valid_until per user, over every membership considered (expired or
  // not): that is what separates 'expired' from 'never'. Ordered by primary key
  // so the paged reads are stable.
  const latest = new Map<string, string>()
  const memberships = await fetchAllPages<{ user_id: string; valid_until: string }>((from, to) => {
    let query = supabase
      .from('user_memberships')
      .select('user_id, valid_until')
      .order('id', { ascending: true })
      .range(from, to)
    if (options.membershipId) query = query.eq('membership_id', options.membershipId)
    return query.overrideTypes<{ user_id: string; valid_until: string }[], { merge: false }>()
  })
  for (const { user_id, valid_until } of memberships) {
    const existing = latest.get(user_id)
    if (!existing || valid_until > existing) latest.set(user_id, valid_until)
  }

  const wanted = new Set(options.statuses)
  const rows: UserRow[] = []
  for (const user of users) {
    const validUntil = latest.get(user.id) ?? null
    // valid_until is a DATE, so the string comparison is a calendar comparison.
    const status: MembershipStatus =
      validUntil === null ? 'never' : validUntil >= today ? 'current' : 'expired'
    if (!wanted.has(status)) continue
    rows.push({
      user_id: user.id,
      member_id: user.member_id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      membership_status: status,
      valid_until: validUntil,
      onboarding_completed_at: user.onboarding_completed_at,
    })
  }

  return rows
}
