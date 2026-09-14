import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncUserToXeroContact } from '@/lib/xero/contacts'
import { logger } from '@/lib/logging/logger'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await request.json()

    // Get complete user data from database instead of relying on passed data
    const { data: completeUserData, error: userDataError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, phone, member_id')
      .eq('id', user.id)
      .single()

    if (userDataError || !completeUserData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get active Xero tenant
    const { data: activeTenant } = await supabase
      .from('xero_oauth_tokens')
      .select('tenant_id, tenant_name')
      .eq('is_active', true)
      .single()

    if (!activeTenant) {
      return NextResponse.json({ 
        success: false, 
        error: 'No active Xero connection' 
      })
    }

    // Sync user to Xero using complete database data
    const result = await syncUserToXeroContact(
      user.id,
      activeTenant.tenant_id,
      completeUserData
    )

    return NextResponse.json(result)

  } catch (error) {
    logger.logXeroSync('sync-user-failed', 'Error syncing user to Xero', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ 
      success: false,
      error: 'Failed to sync user to Xero' 
    }, { status: 500 })
  }
} 