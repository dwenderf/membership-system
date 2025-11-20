import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
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

    // Return sanitized config info (never expose full secrets)
    return NextResponse.json({
      hasClientId: !!process.env.XERO_CLIENT_ID,
      clientIdPrefix: process.env.XERO_CLIENT_ID?.substring(0, 8) + '...',
      hasClientSecret: !!process.env.XERO_CLIENT_SECRET,
      clientSecretPrefix: process.env.XERO_CLIENT_SECRET?.substring(0, 4) + '...',
      redirectUri: process.env.XERO_REDIRECT_URI,
      scopes: process.env.XERO_SCOPES?.split(' ') || ['accounting.transactions', 'accounting.contacts', 'accounting.settings', 'offline_access'],
      environment: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
      vercelUrl: process.env.VERCEL_URL
    })
  } catch (error) {
    console.error('Error checking Xero config:', error)
    return NextResponse.json({
      error: 'Failed to check configuration',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
