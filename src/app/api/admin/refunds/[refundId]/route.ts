import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'

import { xeroStagingManager } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'

// PUT /api/admin/refunds/[refundId] - Update refund status or sync to Xero
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ refundId: string }> }
) {
  const supabase = await createClient()
  const logger = Logger.getInstance()

  try {
    const { refundId } = await params
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
      .eq('id', refundId)
      .single()

    if (refundError || !refund) {
      logger.logSystem('refund-update-error', 'Refund not found', { 
        refundId: refundId,
        error: refundError?.message 
      })
      return NextResponse.json({ error: 'Refund not found' }, { status: 404 })
    }

    if (action === 'sync_xero') {
      // Manually trigger staging for this refund's credit note
      try {
        const stagingSuccess = await xeroStagingManager.createCreditNoteStaging(
          refundId,
          refund.payment_id,
          centsToCents(refund.amount)
        )
        
        if (stagingSuccess) {
          logger.logSystem('refund-xero-staging-manual', 'Manual credit note staging completed', {
            refundId: refundId,
            triggeredBy: authUser.id
          })

          return NextResponse.json({
            success: true,
            message: 'Credit note staging completed successfully. It will be synced to Xero during the next batch sync.'
          })
        } else {
          throw new Error('Failed to create staging record')
        }

      } catch (stagingError) {
        logger.logSystem('refund-xero-staging-manual-error', 'Manual credit note staging failed', {
          refundId: refundId,
          triggeredBy: authUser.id,
          error: stagingError instanceof Error ? stagingError.message : 'Unknown error'
        })

        return NextResponse.json({
          error: 'Failed to stage credit note: ' + (stagingError instanceof Error ? stagingError.message : 'Unknown error')
        }, { status: 500 })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  } catch (error) {
    logger.logSystem('refund-update-error', 'Unexpected error updating refund', { 
      refundId: 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}