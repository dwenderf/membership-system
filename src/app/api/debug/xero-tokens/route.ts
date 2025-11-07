import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

interface TokenStatusResult {
  status: string
  tenant_name: any
  tenant_id: any
  expires_at: any
  current_time: string
  minutes_until_expiry: number
  is_expired: boolean
  days_since_auth: number
  created_at: any
  updated_at: any
  access_token_prefix: string
  refresh_token_prefix: string
  message?: string
  action?: string
  warning?: string
  recommended_action?: string
  critical?: string
  required_action?: string
}

export async function GET() {
  try {
    const supabase = createAdminClient()
    
    // Get current token data
    const { data: tokens, error } = await supabase
      .from('xero_oauth_tokens')
      .select('*')
      .eq('is_active', true)
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ 
        status: 'no_tokens',
        message: 'No active Xero tokens found',
        action: 'Need to authenticate with Xero'
      })
    }
    
    const token = tokens[0]
    const now = new Date()
    const expiresAt = new Date(token.expires_at)
    const timeDiff = expiresAt.getTime() - now.getTime()
    const minutesUntilExpiry = Math.floor(timeDiff / (1000 * 60))
    const isExpired = timeDiff < 0
    
    // Calculate days since last authentication
    const createdAt = new Date(token.created_at)
    const daysSinceAuth = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
    
    const result: TokenStatusResult = {
      status: isExpired ? 'expired' : (minutesUntilExpiry < 60 ? 'expiring_soon' : 'valid'),
      tenant_name: token.tenant_name,
      tenant_id: token.tenant_id,
      expires_at: token.expires_at,
      current_time: now.toISOString(),
      minutes_until_expiry: minutesUntilExpiry,
      is_expired: isExpired,
      days_since_auth: daysSinceAuth,
      created_at: token.created_at,
      updated_at: token.updated_at,
      access_token_prefix: token.access_token.substring(0, 20) + '...',
      refresh_token_prefix: token.refresh_token.substring(0, 20) + '...'
    }
    
    // Add recommendations
    if (isExpired) {
      result.message = 'Access token is expired'
      result.action = 'Token refresh should be attempted automatically'
    } else if (minutesUntilExpiry < 60) {
      result.message = 'Access token expires soon'
      result.action = 'Will be refreshed automatically on next request'
    } else {
      result.message = 'Access token is valid'
      result.action = 'No action needed'
    }
    
    // Check if refresh token might be expired (Xero demo companies)
    if (daysSinceAuth > 7) {
      result.warning = 'Refresh token may be expired (Xero demo companies: 7-14 days)'
      result.recommended_action = 'Consider re-authenticating with Xero'
    } else if (daysSinceAuth > 14) {
      result.critical = 'Refresh token likely expired (even for demo companies)'
      result.required_action = 'Must re-authenticate with Xero'
    }
    
    return NextResponse.json(result)
    
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}