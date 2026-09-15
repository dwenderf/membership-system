import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revokeXeroTokens } from '@/lib/xero/client'
import { logger } from '@/lib/logging/logger'

export async function POST() {
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
      logger.logXeroSync('disconnect-deactivate-failed', 'Error deactivating Xero token', { error: deactivateError.message }, 'error')
      return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 })
    }

    logger.logXeroSync('disconnected', 'Xero integration disconnected by admin', { userId: user.id })

    return NextResponse.json({
      message: 'Xero integration disconnected successfully'
    })

  } catch (error) {
    logger.logXeroSync('disconnect-failed', 'Error disconnecting Xero', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ 
      error: 'Failed to disconnect Xero integration' 
    }, { status: 500 })
  }
}