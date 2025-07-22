import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncUserToXeroContact } from '@/lib/xero/contacts'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { userData } = body

    if (!userData) {
      return NextResponse.json({ error: 'User data required' }, { status: 400 })
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

    // Sync user to Xero
    const result = await syncUserToXeroContact(
      user.id,
      activeTenant.tenant_id,
      userData
    )

    return NextResponse.json(result)

  } catch (error) {
    console.error('Error syncing user to Xero:', error)
    return NextResponse.json({ 
      success: false,
      error: 'Failed to sync user to Xero' 
    }, { status: 500 })
  }
} 