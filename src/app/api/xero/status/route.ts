import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateXeroConnection } from '@/lib/xero/client'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check if user is authenticated and is admin
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: userData, error: userDataError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (userDataError || !userData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get all active Xero connections
    const { data: connections, error: connectionsError } = await supabase
      .from('xero_oauth_tokens')
      .select('tenant_id, tenant_name, expires_at, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (connectionsError) {
      console.error('Error fetching Xero connections:', connectionsError)
      return NextResponse.json({ error: 'Failed to fetch connections' }, { status: 500 })
    }

    // Check connection status for each tenant
    const connectionsWithStatus = await Promise.all(
      (connections || []).map(async (connection) => {
        const isValid = await validateXeroConnection(connection.tenant_id)
        const expiresAt = new Date(connection.expires_at)
        const now = new Date()
        const isExpired = now >= expiresAt
        
        return {
          tenant_id: connection.tenant_id,
          tenant_name: connection.tenant_name,
          expires_at: connection.expires_at,
          created_at: connection.created_at,
          is_expired: isExpired,
          is_valid: isValid,
          status: isExpired ? 'expired' : isValid ? 'connected' : 'error'
        }
      })
    )

    // Get sync statistics
    const { data: syncStats, error: syncStatsError } = await supabase
      .from('xero_sync_logs')
      .select('id, status, operation_type, entity_type, created_at, response_data, request_data, error_message')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
      .order('created_at', { ascending: false })

    // Get pending invoices with details (only 'pending' - staged invoices are not ready)
    const { data: pendingInvoices, error: pendingInvoicesError } = await supabase
      .from('xero_invoices')
      .select(`
        id,
        sync_status,
        net_amount,
        staging_metadata,
        payment_id,
        last_synced_at,
        payments (
          user_id,
          status,
          stripe_payment_intent_id,
          users!payments_user_id_fkey (
            first_name,
            last_name,
            member_id
          )
        )
      `)
      .eq('sync_status', 'pending')
      .order('staged_at', { ascending: true })

    if (pendingInvoicesError) {
      console.error('Error fetching pending invoices:', pendingInvoicesError)
    }

    // Get pending payments with details (only 'pending' - staged payments are not ready)
    const { data: pendingPayments, error: pendingPaymentsError } = await supabase
      .from('xero_payments')
      .select(`
        id,
        sync_status,
        amount_paid,
        reference,
        staging_metadata,
        last_synced_at,
        xero_invoice_id,
        xero_invoices (
          payment_id,
          payments (
            user_id,
            status,
            stripe_payment_intent_id,
            users!payments_user_id_fkey (
              first_name,
              last_name,
              member_id
            )
          )
        )
      `)
      .eq('sync_status', 'pending')
      .order('staged_at', { ascending: true })

    if (pendingPaymentsError) {
      console.error('Error fetching pending payments:', pendingPaymentsError)
    }

    // Get failed invoices with user information - only show retryable ones
    // (zero-value invoices or invoices with completed payments)
    const { data: failedInvoices, error: failedInvoicesError } = await supabase
      .from('xero_invoices')
      .select(`
        id, 
        tenant_id, 
        sync_status, 
        sync_error, 
        last_synced_at, 
        staging_metadata,
        payment_id,
        payments (
          user_id,
          status,
          final_amount,
          users!payments_user_id_fkey (
            first_name,
            last_name,
            member_id
          )
        )
      `).eq('sync_status', 'failed')      
      .not('payment_id', 'is', null)
      .order('last_synced_at', { ascending: false })

      
    if (failedInvoicesError) {
      console.error('Error fetching failed invoices:', failedInvoicesError)
    }

    // Filter out invoices that shouldn't be synced (non-zero amounts with non-completed payments)
    const filteredFailedInvoices = failedInvoices?.filter(invoice => {
      const payment = Array.isArray(invoice.payments) ? invoice.payments[0] : invoice.payments
      if (!payment) return true // Keep if no payment data (shouldn't happen)
      
      // If it's a zero-value invoice, allow retry
      if (payment.final_amount === 0) return true
      
      // If payment is completed, allow retry
      if (payment.status === 'completed') return true
      
      // Non-zero amount with non-completed payment - don't show for retry
      console.log('Filtering out invoice for retry:', {
        invoiceId: invoice.id,
        paymentStatus: payment.status,
        finalAmount: payment.final_amount,
        reason: 'Non-zero amount with non-completed payment'
      })
      return false
    }) || []

    const { data: failedPayments, error: failedPaymentsError } = await supabase
      .from('xero_payments')
      .select(`
        id, 
        tenant_id, 
        sync_status, 
        sync_error, 
        last_synced_at,
        xero_invoice_id,
        xero_invoices (
          payment_id,
          payments (
            user_id,
            users!payments_user_id_fkey (
              first_name,
              last_name,
              member_id
            )
          )
        )
      `)
      .eq('sync_status', 'failed')
      .order('last_synced_at', { ascending: false })

    if (failedPaymentsError) {
      console.error('Error fetching failed payments:', failedPaymentsError)
    }

    const stats = {
      total_operations: syncStats?.length || 0,
      successful_operations: syncStats?.filter(s => s.status === 'success').length || 0,
      failed_operations: syncStats?.filter(s => s.status === 'error').length || 0,
      recent_operations: syncStats?.slice(0, 10) || [],
      pending_invoices: pendingInvoices?.length || 0,
      pending_payments: pendingPayments?.length || 0,
      total_pending: (pendingInvoices?.length || 0) + (pendingPayments?.length || 0),
      pending_invoices_list: pendingInvoices || [],
      pending_payments_list: pendingPayments || [],
      failed_invoices: filteredFailedInvoices,
      failed_payments: failedPayments || [],
      failed_count: filteredFailedInvoices.length + (failedPayments?.length || 0)
    }

    // Add debugging information
    console.log('Xero status API response:', {
      failedInvoicesCount: filteredFailedInvoices.length,
      failedPaymentsCount: failedPayments?.length || 0,
      totalFailedCount: stats.failed_count,
      failedInvoicesError: failedInvoicesError?.message,
      failedPaymentsError: failedPaymentsError?.message
    })

    return NextResponse.json({
      connections: connectionsWithStatus,
      stats,
      is_configured: connectionsWithStatus.length > 0,
      has_active_connection: connectionsWithStatus.some(c => c.status === 'connected')
    })

  } catch (error) {
    console.error('Error fetching Xero status:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch Xero status' 
    }, { status: 500 })
  }
}