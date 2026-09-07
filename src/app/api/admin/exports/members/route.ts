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
 *   dataset          'members' (default) — one row per member
 *                    'memberships'       — one row per member per membership
 *                                          type, with the latest expiry
 *   membership_id    uuid; restrict 'memberships' to a single membership type
 *   paid_only        'true' to count only paid memberships (default: all)
 *   include_deleted  'true' to include soft-deleted members (default: exclude)
 *   format           'json' (default) or 'csv'
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
  membership_id: string
  membership_name: string
  valid_until: string
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
        ? await fetchMembers(supabase, includeDeleted)
        : await fetchMemberships(supabase, { membershipId, paidOnly, includeDeleted })

    logger.logAdminAction(
      'export-members',
      `Served ${rows.length} row(s) from the member export`,
      { dataset, membershipId, paidOnly, includeDeleted, format },
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
  includeDeleted: boolean
): Promise<MemberRow[]> {
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

    if (!includeDeleted) query = query.is('deleted_at', null)

    const { data, error } = await query.overrideTypes<MemberRow[], { merge: false }>()
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }

  return rows
}

async function fetchMemberships(
  supabase: AdminClient,
  options: { membershipId: string | null; paidOnly: boolean; includeDeleted: boolean }
): Promise<MembershipRow[]> {
  interface Joined {
    membership_id: string
    valid_until: string
    users: {
      first_name: string
      last_name: string
      email: string
      member_id: number | null
      deleted_at: string | null
    } | null
    memberships: { name: string } | null
  }

  const joined: Joined[] = []

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    // user_id and membership_id are NOT NULL FKs declared on user_memberships,
    // so both embeds are single objects rather than arrays (see AGENTS.md).
    // Ordered by primary key so the paged reads are stable; the output order
    // is imposed after grouping, below.
    let query = supabase
      .from('user_memberships')
      .select(
        'membership_id, valid_until, users(first_name, last_name, email, member_id, deleted_at), memberships(name)'
      )
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (options.membershipId) query = query.eq('membership_id', options.membershipId)
    if (options.paidOnly) query = query.eq('payment_status', 'paid')

    const { data, error } = await query.overrideTypes<Joined[], { merge: false }>()
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    joined.push(...data)
    if (data.length < PAGE_SIZE) break
  }

  // One row per member per membership type, carrying the latest expiry —
  // this is the max(valid_until) ... GROUP BY the replaced functions did.
  const latest = new Map<string, MembershipRow>()

  for (const row of joined) {
    const user = row.users
    if (!user) continue
    if (!options.includeDeleted && user.deleted_at) continue

    const key = `${user.email}|${row.membership_id}`
    const existing = latest.get(key)

    if (!existing || row.valid_until > existing.valid_until) {
      latest.set(key, {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        member_id: user.member_id,
        membership_id: row.membership_id,
        membership_name: row.memberships?.name ?? '',
        valid_until: row.valid_until,
      })
    }
  }

  return [...latest.values()].sort(
    (a, b) => (a.member_id ?? Infinity) - (b.member_id ?? Infinity)
  )
}
