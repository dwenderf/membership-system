import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logXeroSync } from '@/lib/xero-client'

export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => ({}))
    const { tenant_id } = body

    // If tenant_id is provided, disconnect specific tenant, otherwise disconnect all
    let query = supabase
      .from('xero_oauth_tokens')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })

    if (tenant_id) {
      query = query.eq('tenant_id', tenant_id)
    } else {
      // Disconnect all active tokens
      query = query.eq('is_active', true)
    }

    const { error: deactivateError } = await query

    if (deactivateError) {
      console.error('Error deactivating Xero token:', deactivateError)
      return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 })
    }

    // Log the disconnection
    if (tenant_id) {
      await logXeroSync(
        tenant_id,
        'token_refresh',
        null,
        null,
        null,
        'success',
        undefined,
        'Xero integration disconnected by admin'
      )
    } else {
      // If no specific tenant_id, we can't log to the tenant-specific log
      console.log('All Xero integrations disconnected by admin')
    }

    return NextResponse.json({ 
      message: 'Xero integration disconnected successfully' 
    })

  } catch (error) {
    console.error('Error disconnecting Xero:', error)
    return NextResponse.json({ 
      error: 'Failed to disconnect Xero integration' 
    }, { status: 500 })
  }
}