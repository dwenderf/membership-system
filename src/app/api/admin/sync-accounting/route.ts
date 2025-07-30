import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

export async function POST(request: NextRequest) {
  try {
    // Call the existing Xero manual sync endpoint
    const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/xero/manual-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (response.ok) {
      const data = await response.json()
      
      logger.logBatchProcessing('admin-sync-accounting', 'Manual Xero sync triggered from admin dashboard', {
        results: data.results
      })

      return NextResponse.json({
        success: true,
        message: 'Xero sync completed',
        results: data.results
      })
    } else {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Xero sync failed')
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    logger.logBatchProcessing('admin-sync-accounting-error', 'Manual Xero sync failed', { 
      error: errorMessage
    }, 'error')

    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    
    // Get pending Xero records count
    const { count: pendingInvoices } = await supabase
      .from('xero_invoices')
      .select('*', { count: 'exact', head: true })
      .eq('sync_status', 'pending')

    const { count: pendingPayments } = await supabase
      .from('xero_payments')
      .select('*', { count: 'exact', head: true })
      .eq('sync_status', 'pending')

    return NextResponse.json({
      success: true,
      pendingInvoices: pendingInvoices || 0,
      pendingPayments: pendingPayments || 0
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500 })
  }
} 