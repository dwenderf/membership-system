import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'

import { xeroStagingManager } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'

// PUT /api/admin/refunds/[refundId] - Update refund status or sync to Xero
export async function PUT(
  request: NextRequest,
  { params }: { params: { refundId: string } }
) {
  const supabase = await createClient()
  const logger = Logger.getInstance()

  try {
    // Check if current user is admin
    const { data: { user: authUser } } = await supabase.auth.getUser()
    
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse request body
    const body = await request.json()
    const { action } = body

    // Validate refund exists
    const { data: refund, error: refundError } = await supabase
      .from('refunds')
      .select('*')
      .eq('id', params.refundId)
      .single()

    if (refundError || !refund) {
      logger.logSystem('refund-update-error', 'Refund not found', { 
        refundId: params.refundId,
        error: refundError?.message 
      })
      return NextResponse.json({ error: 'Refund not found' }, { status: 404 })
    }

    if (action === 'sync_xero') {
      // TODO: Re-implement manual Xero sync for refunds
      // The createCreditNoteStaging method has been replaced with createRefundStaging
      // which requires additional refund type information
      logger.logSystem('refund-xero-staging-manual-disabled', 'Manual Xero sync not available', {
        refundId: params.refundId,
        triggeredBy: authUser.id
      })

      return NextResponse.json({
        error: 'Manual Xero sync for refunds is currently not available. Please use the automated batch sync.'
      }, { status: 501 })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  } catch (error) {
    logger.logSystem('refund-update-error', 'Unexpected error updating refund', { 
      refundId: params.refundId,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}