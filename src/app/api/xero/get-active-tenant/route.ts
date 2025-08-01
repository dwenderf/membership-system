import { NextRequest, NextResponse } from 'next/server'
import { getActiveTenant } from '@/lib/xero/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized' 
      }, { status: 401 })
    }

    const activeTenant = await getActiveTenant()
    
    if (!activeTenant) {
      return NextResponse.json({ 
        success: false, 
        error: 'No active Xero tenant found' 
      }, { status: 404 })
    }

    // Only return minimal data needed for the sync operation
    return NextResponse.json({
      success: true,
      tenant: {
        tenant_id: activeTenant.tenant_id
        // Note: Not returning tenant_name or expires_at for security
      }
    })
  } catch (error) {
    console.error('Error getting active Xero tenant:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
} 