import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isRefreshTokenExpired } from '@/lib/xero/client'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    
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

    // Get time window parameter (default to 24h)
    const timeWindow = searchParams.get('timeWindow') || '24h'
    let timeRange: number
    
    switch (timeWindow) {
      case '7d':
        timeRange = 7 * 24 * 60 * 60 * 1000
        break
      case '30d':
        timeRange = 30 * 24 * 60 * 60 * 1000
        break
      case '24h':
      default:
        timeRange = 24 * 60 * 60 * 1000
        break
    }

    // Get all active Xero connections
    const { data: connections, error: connectionsError } = await supabase
      .from('xero_oauth_tokens')
      .select('tenant_id, tenant_name, expires_at, created_at, updated_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (connectionsError) {
      console.error('Error fetching Xero connections:', connectionsError)
      return NextResponse.json({ error: 'Failed to fetch connections' }, { status: 500 })
    }

    // Check connection status for each tenant using the proper helper function
    const connectionsWithStatus = (connections || []).map((connection) => {
      // Use the helper function to check refresh token expiry (60 days from updated_at)
      const isRefreshExpired = isRefreshTokenExpired(connection.updated_at)
      
      // Also check access token expiry (short term)
      const accessTokenExpiresAt = new Date(connection.expires_at)
      const now = new Date()
      const isAccessExpired = now >= accessTokenExpiresAt
      
      // Connection is valid if refresh token is not expired (access token can be refreshed)
      const isValid = !isRefreshExpired
      const status = isRefreshExpired ? 'expired' : 'connected'
      
      // Add debugging for connection status
      console.log('Connection status check:', {
        tenant_id: connection.tenant_id,
        tenant_name: connection.tenant_name,
        access_token_expires_at: connection.expires_at,
        refresh_token_updated_at: connection.updated_at,
        now: now.toISOString(),
        isAccessExpired,
        isRefreshExpired,
        isValid,
        status,
        accessTokenTimeUntilExpiry: accessTokenExpiresAt.getTime() - now.getTime(),
        refreshTokenDaysUntilExpiry: Math.floor((new Date(connection.updated_at).getTime() + (60 * 24 * 60 * 60 * 1000) - now.getTime()) / (24 * 60 * 60 * 1000))
      })
      
      return {
        tenant_id: connection.tenant_id,
        tenant_name: connection.tenant_name,
        expires_at: connection.expires_at,
        created_at: connection.created_at,
        updated_at: connection.updated_at,
        is_expired: isRefreshExpired,
        is_valid: isValid,
        status: status
      }
    })

    // Get sync statistics
    const { data: syncStats, error: syncStatsError } = await supabase
      .from('xero_sync_logs')
      .select('id, status, operation_type, entity_type, created_at, response_data, request_data, error_message')
      .gte('created_at', new Date(Date.now() - timeRange).toISOString())
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

    // Get failed and ignored invoices with user information - only show retryable ones
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
      `).in('sync_status', ['failed', 'ignore'])      
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
      .in('sync_status', ['failed', 'ignore'])
      .order('last_synced_at', { ascending: false })

    if (failedPaymentsError) {
      console.error('Error fetching failed payments:', failedPaymentsError)
    }

    // Separate failed and ignored items
    const failedInvoicesOnly = filteredFailedInvoices.filter(item => item.sync_status === 'failed')
    const failedPaymentsOnly = (failedPayments || []).filter(item => item.sync_status === 'failed')
    const ignoredInvoices = filteredFailedInvoices.filter(item => item.sync_status === 'ignore')
    const ignoredPayments = (failedPayments || []).filter(item => item.sync_status === 'ignore')

    // Combine and sort all failed and ignored items by time (most recent first)
    const allFailedItems = [
      ...filteredFailedInvoices.map(item => ({ ...item, item_type: 'invoice' })),
      ...(failedPayments || []).map(item => ({ ...item, item_type: 'payment' }))
    ].sort((a, b) => new Date(b.last_synced_at).getTime() - new Date(a.last_synced_at).getTime())

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
      failed_invoices: failedInvoicesOnly,
      failed_payments: failedPaymentsOnly,
      failed_items_sorted: allFailedItems, // Combined and sorted array (includes both failed and ignored)
      failed_count: failedInvoicesOnly.length + failedPaymentsOnly.length,
      ignored_invoices: ignoredInvoices,
      ignored_payments: ignoredPayments,
      ignored_count: ignoredInvoices.length + ignoredPayments.length
    }

    // Add debugging information
    console.log('Xero status API response:', {
      pendingInvoicesCount: pendingInvoices?.length || 0,
      pendingPaymentsCount: pendingPayments?.length || 0,
      failedInvoicesCount: filteredFailedInvoices.length,
      failedPaymentsCount: failedPayments?.length || 0
    })

    const response = {
      connections: connectionsWithStatus,
      stats,
      is_configured: connectionsWithStatus.length > 0,
      has_active_connection: connectionsWithStatus.some(c => c.status === 'connected')
    }

    // Add debugging for connection status
    console.log('Final connection status:', {
      connectionsCount: connectionsWithStatus.length,
      connections: connectionsWithStatus.map(c => ({
        tenant_name: c.tenant_name,
        status: c.status,
        is_expired: c.is_expired,
        expires_at: c.expires_at
      })),
      is_configured: response.is_configured,
      has_active_connection: response.has_active_connection
    })

    return NextResponse.json(response)

  } catch (error) {
    console.error('Error fetching Xero status:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch Xero status' 
    }, { status: 500 })
  }
}