import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

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

    return NextResponse.json({
      registrations: registrations || []
    })

  } catch (error) {
    logger.logAdminAction('payment-registrations-fetch-exception', 'Unexpected error in payment registrations API', { error: error instanceof Error ? error.message : String(error) }, undefined, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}