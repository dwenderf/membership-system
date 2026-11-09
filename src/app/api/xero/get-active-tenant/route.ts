import { NextResponse } from 'next/server'
import { getActiveTenant } from '@/lib/xero/client'
import { requireAdmin } from '@/lib/auth/require-admin'
import { logger } from '@/lib/logging/logger'

export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

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
    logger.logXeroSync('get-active-tenant-failed', 'Error getting active Xero tenant', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}
