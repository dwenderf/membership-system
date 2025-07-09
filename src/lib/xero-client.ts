import { XeroApi, XeroClient } from 'xero-node'

if (!process.env.XERO_CLIENT_ID || !process.env.XERO_CLIENT_SECRET) {
  throw new Error('Missing Xero environment variables')
}

const xero = new XeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  redirectUris: [process.env.XERO_REDIRECT_URI || 'http://localhost:3000/api/xero/callback'],
  scopes: process.env.XERO_SCOPES?.split(' ') || [
    'accounting.transactions',
    'accounting.contacts',
    'accounting.settings',
    'offline_access'
  ]
})

export { xero }

// Helper function to get authenticated Xero client with token refresh
export async function getAuthenticatedXeroClient(tenantId: string): Promise<XeroApi | null> {
  try {
    // Import supabase here to avoid circular dependency
    const { createClient } = await import('./supabase/server')
    const supabase = await createClient()

    // Get stored tokens for the tenant
    const { data: tokenData, error } = await supabase
      .from('xero_oauth_tokens')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single()

    if (error || !tokenData) {
      console.error('No active Xero tokens found for tenant:', tenantId)
      return null
    }

    // Check if token is expired
    const expiresAt = new Date(tokenData.expires_at)
    const now = new Date()
    const isExpired = now >= expiresAt

    if (isExpired) {
      // Try to refresh the token
      const refreshedTokens = await refreshXeroToken(tokenData.refresh_token)
      if (!refreshedTokens) {
        console.error('Failed to refresh Xero token for tenant:', tenantId)
        return null
      }

      // Update the stored tokens
      await supabase
        .from('xero_oauth_tokens')
        .update({
          access_token: refreshedTokens.access_token,
          refresh_token: refreshedTokens.refresh_token,
          expires_at: refreshedTokens.expires_at,
          updated_at: new Date().toISOString()
        })
        .eq('tenant_id', tenantId)

      // Set the new token on the client
      await xero.setTokenSet({
        access_token: refreshedTokens.access_token,
        refresh_token: refreshedTokens.refresh_token,
        expires_at: refreshedTokens.expires_at,
        token_type: 'Bearer',
        scope: tokenData.scope
      })
    } else {
      // Token is still valid, use it
      await xero.setTokenSet({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
        token_type: tokenData.token_type,
        scope: tokenData.scope
      })
    }

    return xero.accountingApi

  } catch (error) {
    console.error('Error getting authenticated Xero client:', error)
    return null
  }
}

// Helper function to refresh Xero token
async function refreshXeroToken(refreshToken: string): Promise<{
  access_token: string
  refresh_token: string
  expires_at: string
} | null> {
  try {
    const refreshedTokenSet = await xero.refreshWithRefreshToken(
      process.env.XERO_CLIENT_ID!,
      process.env.XERO_CLIENT_SECRET!,
      refreshToken
    )

    if (!refreshedTokenSet || !refreshedTokenSet.access_token) {
      return null
    }

    return {
      access_token: refreshedTokenSet.access_token,
      refresh_token: refreshedTokenSet.refresh_token || refreshToken,
      expires_at: refreshedTokenSet.expires_at?.toString() || 
                  new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes from now
    }
  } catch (error) {
    console.error('Error refreshing Xero token:', error)
    return null
  }
}

// Helper function to get all active tenants
export async function getActiveXeroTenants(): Promise<Array<{
  tenant_id: string
  tenant_name: string
  expires_at: string
}>> {
  try {
    const { createClient } = await import('./supabase/server')
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('xero_oauth_tokens')
      .select('tenant_id, tenant_name, expires_at')
      .eq('is_active', true)

    if (error) {
      console.error('Error fetching active Xero tenants:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Error getting active Xero tenants:', error)
    return []
  }
}

// Helper function to validate Xero connection
export async function validateXeroConnection(tenantId: string): Promise<boolean> {
  try {
    const xeroApi = await getAuthenticatedXeroClient(tenantId)
    if (!xeroApi) {
      return false
    }

    // Try to get organization details as a connection test
    const response = await xeroApi.getOrganisations(tenantId)
    return response.body.organisations && response.body.organisations.length > 0
  } catch (error) {
    console.error('Error validating Xero connection:', error)
    return false
  }
}

// Helper function to log Xero sync operations
export async function logXeroSync(
  tenantId: string,
  operationType: 'contact_sync' | 'invoice_sync' | 'payment_sync' | 'token_refresh',
  entityType: 'user' | 'payment' | 'invoice' | 'contact' | null,
  entityId: string | null,
  xeroEntityId: string | null,
  status: 'success' | 'error' | 'warning',
  errorCode?: string,
  errorMessage?: string,
  requestData?: any,
  responseData?: any
): Promise<void> {
  try {
    const { createClient } = await import('./supabase/server')
    const supabase = await createClient()

    await supabase
      .from('xero_sync_logs')
      .insert({
        tenant_id: tenantId,
        operation_type: operationType,
        entity_type: entityType,
        entity_id: entityId,
        xero_entity_id: xeroEntityId,
        status,
        error_code: errorCode,
        error_message: errorMessage,
        request_data: requestData,
        response_data: responseData
      })

    // Also log to Sentry for errors
    if (status === 'error' && errorMessage) {
      const { captureException } = await import('@sentry/nextjs')
      captureException(new Error(`Xero ${operationType} failed: ${errorMessage}`), {
        extra: {
          tenantId,
          operationType,
          entityType,
          entityId,
          xeroEntityId,
          errorCode,
          requestData,
          responseData
        }
      })
    }
  } catch (error) {
    console.error('Error logging Xero sync:', error)
  }
}