import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'

// POST /api/admin/refunds/cancel - Mark staged refund as 'ignore'
export async function POST(request: NextRequest) {
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
    const { refundId, stagingId } = body

    if (!refundId || !stagingId) {
      return NextResponse.json({ 
        error: 'Refund ID and staging ID are required' 
      }, { status: 400 })
    }

    // Mark refund record as ignored
    const { error: refundError } = await supabase
      .from('refunds')
      .update({
        status: 'ignore',
        failure_reason: 'Cancelled by admin before Stripe submission',
        updated_at: new Date().toISOString()
      })
      .eq('id', refundId)
      .eq('status', 'staged') // Only cancel if still staged

    if (refundError) {
      logger.logSystem('refund-cancel-error', 'Failed to cancel staged refund', { 
        refundId,
        error: refundError.message 
      })
      return NextResponse.json({ 
        error: 'Failed to cancel refund' 
      }, { status: 500 })
    }

    // Mark staging records as ignored
    await supabase
      .from('xero_invoices')
      .update({
        sync_status: 'ignore',
        updated_at: new Date().toISOString()
      })
      .eq('id', stagingId)
      .eq('sync_status', 'staged')

    await supabase
      .from('xero_payments')
      .update({
        sync_status: 'ignore',
        updated_at: new Date().toISOString()
      })
      .eq('xero_invoice_id', stagingId)
      .eq('sync_status', 'staged')

    logger.logSystem('refund-cancelled', 'Staged refund cancelled by admin', {
      refundId,
      stagingId,
      cancelledBy: authUser.id
    })

    return NextResponse.json({
      success: true,
      message: 'Refund staging cancelled successfully'
    })

  } catch (error) {
    logger.logSystem('refund-cancel-error', 'Unexpected error cancelling staged refund', { 
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}