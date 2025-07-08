import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logXeroSync } from '@/lib/xero-client'

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    
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

    const { tenant_id } = await request.json()

    if (!tenant_id) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 })
    }

    // Deactivate the token instead of deleting to preserve audit trail
    const { error: deactivateError } = await supabase
      .from('xero_oauth_tokens')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('tenant_id', tenant_id)

    if (deactivateError) {
      console.error('Error deactivating Xero token:', deactivateError)
      return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 })
    }

    // Log the disconnection
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