import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'
import { processRefundWithXero } from '@/lib/xero/credit-notes'

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
      // Manually trigger Xero sync for this refund
      try {
        await processRefundWithXero(params.refundId)
        
        logger.logSystem('refund-xero-sync-manual', 'Manual Xero sync triggered', {
          refundId: params.refundId,
          triggeredBy: authUser.id
        })

        return NextResponse.json({
          success: true,
          message: 'Xero sync completed successfully'
        })

      } catch (xeroError) {
        logger.logSystem('refund-xero-sync-manual-error', 'Manual Xero sync failed', {
          refundId: params.refundId,
          triggeredBy: authUser.id,
          error: xeroError instanceof Error ? xeroError.message : 'Unknown error'
        })

        return NextResponse.json({
          error: 'Failed to sync with Xero: ' + (xeroError instanceof Error ? xeroError.message : 'Unknown error')
        }, { status: 500 })
      }
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