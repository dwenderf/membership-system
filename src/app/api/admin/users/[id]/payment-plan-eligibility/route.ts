import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

/**
 * GET /api/admin/users/[id]/payment-plan-eligibility
 * Get user's payment plan eligibility status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()

    // Check if user is admin
    const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser()
    if (authError || !currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: adminCheck } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', currentUser.id)
      .single()

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get user's payment plan eligibility
    const { data: user, error } = await supabase
      .from('users')
      .select('payment_plan_enabled')
      .eq('id', params.id)
      .single()

    if (error || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      userId: params.id,
      paymentPlanEnabled: user.payment_plan_enabled
    })
  } catch (error) {
    logger.logAdminAction(
      'get-payment-plan-eligibility-error',
      'Error getting payment plan eligibility',
      {
        userId: params.id,
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/admin/users/[id]/payment-plan-eligibility
 * Update user's payment plan eligibility
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    // Check if user is admin
    const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser()
    if (authError || !currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: adminCheck } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', currentUser.id)
      .single()

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get request body
    const body = await request.json()
    const { enabled } = body

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }

    // Update user's payment plan eligibility
    const { data: updatedUser, error: updateError } = await adminSupabase
      .from('users')
      .update({ payment_plan_enabled: enabled })
      .eq('id', params.id)
      .select('id, email, first_name, last_name, payment_plan_enabled')
      .single()

    if (updateError) {
      logger.logAdminAction(
        'update-payment-plan-eligibility-error',
        'Error updating payment plan eligibility',
        {
          userId: params.id,
          enabled,
          error: updateError.message
        },
        'error'
      )
      return NextResponse.json({ error: 'Failed to update eligibility' }, { status: 500 })
    }

    logger.logAdminAction(
      'payment-plan-eligibility-updated',
      `Payment plan eligibility ${enabled ? 'enabled' : 'disabled'} for user`,
      {
        userId: params.id,
        adminUserId: currentUser.id,
        enabled
      },
      'info'
    )

    return NextResponse.json({
      success: true,
      user: updatedUser
    })
  } catch (error) {
    logger.logAdminAction(
      'update-payment-plan-eligibility-exception',
      'Exception updating payment plan eligibility',
      {
        userId: params.id,
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
