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
 * Query parameters:
 *   dataset          'members' (default) — one row per user account,
 *                                          whether or not they hold a
 *                                          membership
 *                    'memberships'       — one row per member holding a
 *                                          counted membership, with the
 *                                          latest valid_until of the
 *                                          memberships counted
 *   include_expired  'memberships' only: 'true' to also count memberships
 *                    whose valid_until is before today (default: only
 *                    memberships valid today or later, in
 *                    NEXT_PUBLIC_APP_TIMEZONE)
 *   membership_id    uuid; restrict 'memberships' to a single membership type
 *   paid_only        'memberships' only: 'true' to count only paid
 *                    memberships (default: all)
 *   include_deleted  'true' to include soft-deleted users (default: exclude);
 *                    applies to both datasets
 *   format           'json' (default) or 'csv'
 *
 * paid_only or include_expired with dataset=members is a 400, not ignored.
 * An export larger than MAX_ROWS fails (500) rather than returning a partial list.
 */

// PostgREST caps a single response; page through rather than silently truncating.
const PAGE_SIZE = 1000
const MAX_ROWS = 50000

interface MemberRow {
  first_name: string
  last_name: string
  email: string
  member_id: number | null
}

interface MembershipRow extends MemberRow {
  valid_until: string
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

function toCsv(rows: ReadonlyArray<MemberRow | MembershipRow>): string {
  if (rows.length === 0) return ''
  // Both row shapes are flat string/number records; index them dynamically to
  // emit whichever columns the selected dataset produced.
  const asRecord = (row: MemberRow | MembershipRow) => row as unknown as Record<string, unknown>
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

export async function GET(request: NextRequest) {
  const denied = authorize(request)
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const dataset = searchParams.get('dataset') ?? 'members'
  const membershipId = searchParams.get('membership_id')
  const paidOnly = searchParams.get('paid_only') === 'true'
  const includeDeleted = searchParams.get('include_deleted') === 'true'
  const includeExpired = searchParams.get('include_expired') === 'true'
  const format = searchParams.get('format') ?? 'json'

  if (dataset !== 'members' && dataset !== 'memberships') {
    return NextResponse.json(
      { error: "dataset must be 'members' or 'memberships'" },
      { status: 400 }
    )
  }
  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json(
      { error: "format must be 'json' or 'csv'" },
      { status: 400 }
    )
  }
  // These narrowed the members dataset before it became every user account.
  // Reject them there rather than ignore them, so a stale caller fails loudly
  // instead of silently receiving a much wider set of personal data.
  if (dataset === 'members' && (searchParams.has('paid_only') || searchParams.has('include_expired'))) {
    return NextResponse.json(
      {
        error:
          "paid_only and include_expired apply only to dataset=memberships; dataset=members returns every user",
      },
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
    const rows =
      dataset === 'members'
        ? await fetchMembers(supabase, { includeDeleted })
        : await fetchMemberships(supabase, {
            membershipId,
            paidOnly,
            includeDeleted,
            includeExpired,
          })

    logger.logAdminAction(
      'export-members',
      `Served ${rows.length} row(s) from the member export`,
      { dataset, membershipId, paidOnly, includeDeleted, includeExpired, format },
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

async function fetchMembers(
  supabase: AdminClient,
  options: { includeDeleted: boolean }
): Promise<MemberRow[]> {
  // Every user account, membership or not. Membership filtering belongs to the
  // 'memberships' dataset.
  const rows: MemberRow[] = []

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    // Order must be total, not just useful: .range() is OFFSET/LIMIT, and
    // PostgreSQL gives no row order without ORDER BY, so pages of an unordered
    // query can overlap or skip rows. member_id is UNIQUE but nullable, which
    // leaves ties among NULLs -- id (the primary key) breaks them.
    let query = supabase
      .from('users')
      .select('first_name, last_name, email, member_id')
      .order('member_id', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (!options.includeDeleted) query = query.is('deleted_at', null)

    const { data, error } = await query.overrideTypes<MemberRow[], { merge: false }>()
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) return rows

    rows.push(...data)
    if (data.length < PAGE_SIZE) return rows
  }

  // Fell out of the loop with every page full: the result is cut at MAX_ROWS.
  throw new Error(`members export exceeds ${MAX_ROWS} rows`)
}

async function fetchMemberships(
  supabase: AdminClient,
  options: {
    membershipId: string | null
    paidOnly: boolean
    includeDeleted: boolean
    includeExpired: boolean
  }
): Promise<MembershipRow[]> {
  const today = todayInAppTimezone()

  interface Joined {
    user_id: string
    valid_until: string
    users: {
      first_name: string
      last_name: string
      email: string
      member_id: number | null
      deleted_at: string | null
    } | null
  }

  const joined: Joined[] = []
  let complete = false

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    // user_id is a NOT NULL FK declared on user_memberships, so the users embed
    // is a single object rather than an array (see AGENTS.md). Ordered by
    // primary key so the paged reads are stable; the output order is imposed
    // after grouping, below.
    let query = supabase
      .from('user_memberships')
      .select('user_id, valid_until, users(first_name, last_name, email, member_id, deleted_at)')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (!options.includeExpired) query = query.gte('valid_until', today)
    if (options.membershipId) query = query.eq('membership_id', options.membershipId)
    if (options.paidOnly) query = query.eq('payment_status', 'paid')

    const { data, error } = await query.overrideTypes<Joined[], { merge: false }>()
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) {
      complete = true
      break
    }

    joined.push(...data)
    if (data.length < PAGE_SIZE) {
      complete = true
      break
    }
  }

  // Fell out of the loop with every page full: the result is cut at MAX_ROWS.
  if (!complete) throw new Error(`memberships export exceeds ${MAX_ROWS} rows`)

  // One row per member, carrying the latest expiry among the memberships
  // counted. The output has no membership columns, so grouping per membership
  // type would emit indistinguishable duplicate rows for a member holding
  // several types.
  const latest = new Map<string, MembershipRow>()

  for (const row of joined) {
    const user = row.users
    if (!user) continue
    if (!options.includeDeleted && user.deleted_at) continue

    const existing = latest.get(row.user_id)

    if (!existing || row.valid_until > existing.valid_until) {
      latest.set(row.user_id, {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        member_id: user.member_id,
        valid_until: row.valid_until,
      })
    }
  }

  return [...latest.values()].sort(
    (a, b) => (a.member_id ?? Infinity) - (b.member_id ?? Infinity)
  )
}
