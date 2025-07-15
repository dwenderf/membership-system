import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateXeroConnection } from '@/lib/xero-client'

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
      .select('status, operation_type, created_at')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
      .order('created_at', { ascending: false })

    // Get pending invoices count
    const { count: pendingInvoicesCount } = await supabase
      .from('xero_invoices')
      .select('*', { count: 'exact', head: true })
      .in('sync_status', ['pending', 'staged'])

    // Get pending payments count  
    const { count: pendingPaymentsCount } = await supabase
      .from('xero_payments')
      .select('*', { count: 'exact', head: true })
      .eq('sync_status', 'pending')

    // Get failed invoices with user information using raw SQL
    const { data: failedInvoices } = await supabase
      .from('xero_invoices')
      .select(`
        id, 
        tenant_id, 
        sync_status, 
        sync_error, 
        last_synced_at, 
        staging_metadata,
        payment_id,
        payments!left (
          user_id,
          users!left (
            first_name,
            last_name,
            member_id
          )
        )
      `)
      .eq('sync_status', 'failed')
      .not('payment_id', 'is', null)
      .order('last_synced_at', { ascending: false })

    const { data: failedPayments } = await supabase
      .from('xero_payments')
      .select(`
        id, 
        tenant_id, 
        sync_status, 
        sync_error, 
        last_synced_at,
        xero_invoice_id,
        xero_invoices!left (
          payment_id,
          payments!left (
            user_id,
            users!left (
              first_name,
              last_name,
              member_id
            )
          )
        )
      `)
      .eq('sync_status', 'failed')
      .order('last_synced_at', { ascending: false })

    const stats = {
      total_operations: syncStats?.length || 0,
      successful_operations: syncStats?.filter(s => s.status === 'success').length || 0,
      failed_operations: syncStats?.filter(s => s.status === 'error').length || 0,
      recent_operations: syncStats?.slice(0, 10) || [],
      pending_invoices: pendingInvoicesCount || 0,
      pending_payments: pendingPaymentsCount || 0,
      total_pending: (pendingInvoicesCount || 0) + (pendingPaymentsCount || 0),
      failed_invoices: failedInvoices || [],
      failed_payments: failedPayments || [],
      failed_count: (failedInvoices?.length || 0) + (failedPayments?.length || 0)
    }

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