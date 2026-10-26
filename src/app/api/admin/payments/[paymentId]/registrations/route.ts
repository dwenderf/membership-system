import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

interface AlternateSelectionRow {
  id: string
  discount_code_id: string | null
  alternate_registrations: { registration_id: string } | { registration_id: string }[] | null
}

export interface AppliedDiscountCode {
  id: string
  code: string
}

/**
 * Discount codes already applied to this payment: discount line items on the original
 * (synced/pending) ACCREC invoice, plus any code recorded on an alternate selection.
 */
async function getAppliedDiscountCodes(
  supabase: ReturnType<typeof createAdminClient>,
  paymentId: string,
  extraCodeIds: (string | null)[]
): Promise<AppliedDiscountCode[]> {
  const codeIds = new Set<string>(extraCodeIds.filter((id): id is string => !!id))

  const { data: invoices } = await supabase
    .from('xero_invoices')
    .select('id')
    .eq('payment_id', paymentId)
    // Original invoice plus earlier refund credit notes, so codes used in a prior refund are shown too.
    .in('invoice_type', ['ACCREC', 'ACCRECCREDIT'])
    .in('sync_status', ['synced', 'pending'])

  const invoiceIds = (invoices || []).map((i: { id: string }) => i.id)
  if (invoiceIds.length > 0) {
    const { data: lines } = await supabase
      .from('xero_invoice_line_items')
      .select('discount_code_id')
      .in('xero_invoice_id', invoiceIds)
      .eq('line_item_type', 'discount')
    for (const line of (lines || []) as { discount_code_id: string | null }[]) {
      if (line.discount_code_id) codeIds.add(line.discount_code_id)
    }
  }

  if (codeIds.size === 0) return []

  const { data: codes } = await supabase
    .from('discount_codes')
    .select('id, code')
    .in('id', [...codeIds])

  return ((codes || []) as AppliedDiscountCode[]).map(c => ({ id: c.id, code: c.code }))
}

interface RouteParams {
  params: Promise<{
    paymentId: string
  }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { paymentId } = await params
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    // Check if user is authenticated and is admin
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify admin status
    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get registrations associated with this payment (admin client bypasses RLS)
    const { data: registrations, error: registrationsError } = await adminSupabase
      .from('user_registrations')
      .select(`
        registration_id,
        registrations!inner (
          id,
          season_id,
          name,
          seasons!inner (
            id,
            name
          )
        )
      `)
      .eq('payment_id', paymentId)

    if (registrationsError) {
      logger.logAdminAction('payment-registrations-fetch-error', 'Error fetching registrations for payment', { paymentId, error: registrationsError.message }, user.id, 'error')
      return NextResponse.json({ error: 'Failed to fetch registrations' }, { status: 500 })
    }

    // Alternate selections charged on this payment (#454 bug 1). These have no user_registrations
    // row, but the alternate game belongs to a registration, which gives the season context the
    // discount-code refund flow needs.
    const { data: altRows, error: altError } = await adminSupabase
      .from('alternate_selections')
      .select(`
        id,
        discount_code_id,
        alternate_registrations!inner (
          registration_id
        )
      `)
      .eq('payment_id', paymentId)

    if (altError) {
      logger.logAdminAction('payment-alternate-selections-fetch-error', 'Error fetching alternate selections for payment', { paymentId, error: altError.message }, user.id, 'error')
    }

    const alternateSelections = ((altRows || []) as unknown as AlternateSelectionRow[])
      .map(row => {
        const alt = Array.isArray(row.alternate_registrations) ? row.alternate_registrations[0] : row.alternate_registrations
        return alt?.registration_id ? { id: row.id, registration_id: alt.registration_id, discount_code_id: row.discount_code_id } : null
      })
      .filter((row): row is { id: string; registration_id: string; discount_code_id: string | null } => row !== null)

    const appliedDiscountCodes = await getAppliedDiscountCodes(adminSupabase, paymentId, alternateSelections.map(a => a.discount_code_id))

    return NextResponse.json({
      registrations: registrations || [],
      alternateSelections,
      // Registration used for season context when validating a refund discount code.
      discountContextRegistrationId: registrations?.[0]?.registration_id ?? alternateSelections[0]?.registration_id ?? null,
      appliedDiscountCodes
    })

  } catch (error) {
    logger.logAdminAction('payment-registrations-fetch-exception', 'Unexpected error in payment registrations API', { error: error instanceof Error ? error.message : String(error) }, undefined, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
