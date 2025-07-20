import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logXeroSync, revokeXeroTokens } from '@/lib/xero-client'

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

    // Single tenant model: revoke OAuth connections on Xero's side first
    console.log('Revoking Xero OAuth connections...')
    await revokeXeroTokens()

    // Then disconnect all active tokens in our database
    const { error: deactivateError } = await supabase
      .from('xero_oauth_tokens')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('is_active', true)

    if (deactivateError) {
      console.error('Error deactivating Xero token:', deactivateError)
      return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 })
    }

    // Log the disconnection
    console.log('Xero integration disconnected by admin')

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