import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'

/**
 * Authenticated export of registration_reports_data for external consumers
 * (spreadsheets, finance tooling, etc.).
 *
 * registration_reports_data is a security_invoker view over registration
 * financial data (invoice line items joined to registrations, categories and
 * seasons). It is reachable from the signed-in admin app at
 * /api/admin/reports, but that route is paginated for a dashboard UI, not
 * shaped for bulk export. Per AGENTS.md "Views and functions are public API",
 * data leaves this system through an authenticated API route, never a public
 * view or RPC, so this route reads the view with the service-role client
 * after its own auth check rather than handing out query access to it.
 *
 *   GET /api/admin/exports/registrations
 *   Authorization: Bearer $EXPORT_API_SECRET
 *
 * Returns every row of registration_reports_data, in full, with no filtering.
 *
 * Query parameters:
 *   format  'json' (default) or 'csv'
 */

// PostgREST caps a single response; page through rather than silently truncating.
const PAGE_SIZE = 1000

interface RegistrationReportRow {
  line_item_id: string
  line_amount: number
  quantity: number
  line_item_type: string
  description: string | null
  discount_code_id: string | null
  item_id: string | null
  line_item_created_at: string
  invoice_id: string
  invoice_number: string | null
  invoice_type: string
  invoice_status: string
  sync_status: string
  invoice_created_at: string
  invoice_updated_at: string
  payment_id: string | null
  payment_status: string | null
  payment_amount: number | null
  payment_created_at: string | null
  user_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  discount_code: string | null
  discount_category_id: string | null
  discount_category_name: string | null
  absolute_amount: number
  customer_name: string | null
  total_refunded: number | null
  registration_id: string | null
  registration_name: string | null
  registration_type: string | null
  registration_category_id: string | null
  registration_category_name: string | null
  registration_category_price: number | null
  category_name: string | null
  season_id: string | null
  season_name: string | null
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
      'export-registrations-misconfigured',
      'EXPORT_API_SECRET is not set; refusing to serve the registrations export',
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
      'export-registrations-unauthorized',
      'Rejected an unauthenticated registrations export request',
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

function toCsv(rows: ReadonlyArray<RegistrationReportRow>): string {
  if (rows.length === 0) return ''
  const asRecord = (row: RegistrationReportRow) => row as unknown as Record<string, unknown>
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
  const format = searchParams.get('format') ?? 'json'

  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json(
      { error: "format must be 'json' or 'csv'" },
      { status: 400 }
    )
  }

  // Service role: this route does its own authentication above, and the
  // export is deliberately cross-member, which every RLS policy correctly
  // forbids.
  const supabase = createAdminClient()

  try {
    const rows = await fetchRegistrationReportRows(supabase)

    logger.logAdminAction(
      'export-registrations',
      `Served ${rows.length} row(s) from the registrations export`,
      { format },
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
      { dataset: 'registrations', count: rows.length, rows },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.logAdminAction(
      'export-registrations-failed',
      'Registrations export failed',
      { error: message },
      undefined,
      'error'
    )
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Reads every page of registration_reports_data. Ordered by line_item_id
 * (the view's underlying primary key — see reports_financial_data, which
 * aliases xero_invoice_line_items.id), the one column in the view guaranteed
 * unique and non-null, so paged reads via .range() don't overlap or skip rows.
 * Deliberately uncapped: this route's whole purpose is a full export, and the
 * view only grows as invoices sync, so an arbitrary cap would eventually break
 * the export for everyone rather than for an outlier.
 */
async function fetchRegistrationReportRows(supabase: AdminClient): Promise<RegistrationReportRow[]> {
  const rows: RegistrationReportRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('registration_reports_data')
      .select('*')
      .order('line_item_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
      .overrideTypes<RegistrationReportRow[], { merge: false }>()

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) return rows
    rows.push(...data)
    if (data.length < PAGE_SIZE) return rows
  }
}
