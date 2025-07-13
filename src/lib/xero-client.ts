import { XeroApi, XeroClient } from 'xero-node'

if (!process.env.XERO_CLIENT_ID || !process.env.XERO_CLIENT_SECRET) {
  throw new Error('Missing Xero environment variables')
}

// Run startup connection test when this module is first imported
let hasRunStartupTest = false

async function runXeroStartupTest() {
  if (hasRunStartupTest) return
  hasRunStartupTest = true

  // Only run on server side
  if (typeof window !== 'undefined') return

  const { logger } = await import('./logging/logger')
  logger.logXeroSync(
    'startup-test-initiated',
    'Xero startup connection test initiated',
    { delay: '2 seconds' }
  )
  
  try {
    // Small delay to ensure app is ready
    setTimeout(async () => {
      try {
        const activeXeroTenants = await getActiveXeroTenants()
        
        if (activeXeroTenants.length > 0) {
          const { logger } = await import('./logging/logger')
          logger.logXeroSync(
            'startup-connection-test',
            `Found ${activeXeroTenants.length} active Xero tenant(s), testing connection`,
            { tenantCount: activeXeroTenants.length, tenants: activeXeroTenants }
          )
          
          // Test connection to first active tenant
          const isConnected = await validateXeroConnection(activeXeroTenants[0].tenant_id)
          
          if (isConnected) {
            const { logger } = await import('./logging/logger')
            logger.logXeroSync(
              'startup-connection-success',
              `Xero connection verified for: ${activeXeroTenants[0].tenant_name}`,
              { tenantName: activeXeroTenants[0].tenant_name, tenantId: activeXeroTenants[0].tenant_id }
            )
          } else {
            const { logger } = await import('./logging/logger')
            logger.logXeroSync(
              'startup-connection-failed',
              `Xero connection test failed for: ${activeXeroTenants[0].tenant_name}`,
              { tenantName: activeXeroTenants[0].tenant_name, tenantId: activeXeroTenants[0].tenant_id },
              'warn'
            )
          }
        } else {
          const { logger } = await import('./logging/logger')
          logger.logXeroSync(
            'startup-no-tenants',
            'No active Xero tenants found at startup',
            { tenantCount: 0 },
            'warn'
          )
        }
      } catch (error) {
        const { logger } = await import('./logging/logger')
        logger.logXeroSync(
          'startup-test-error',
          'Xero startup test error',
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'warn'
        )
      }
    }, 2000) // 2 second delay to ensure everything is initialized
    
  } catch (error) {
    const { logger } = await import('./logging/logger')
    logger.logXeroSync(
      'startup-test-outer-error',
      'Error during Xero startup test',
      { error: error instanceof Error ? error.message : 'Unknown error' },
      'warn'
    )
  }
}

// Trigger startup test
runXeroStartupTest()

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

// Wrapper function for single-tenant operations
export async function withActiveTenant<T>(
  operation: (tenantId: string) => Promise<T>
): Promise<T | null> {
  const activeTenant = await getActiveTenant()
  if (!activeTenant) {
    const { logger } = await import('./logging/logger')
    logger.logXeroSync(
      'no-active-tenant',
      'No active Xero tenant found',
      {},
      'error'
    )
    return null
  }
  return await operation(activeTenant.tenant_id)
}

// Helper function to get authenticated Xero client with token refresh
export async function getAuthenticatedXeroClient(tenantId: string): Promise<XeroApi | null> {
  try {
    // Import supabase here to avoid circular dependency
    const { createAdminClient } = await import('./supabase/server')
    const supabase = createAdminClient()

    // Get stored tokens for the tenant
    const { data: tokenData, error } = await supabase
      .from('xero_oauth_tokens')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single()

    if (error || !tokenData) {
      const { logger } = await import('./logging/logger')
      logger.logXeroSync(
        'no-active-tokens',
        'No active Xero tokens found for tenant',
        { tenantId },
        'error'
      )
      return null
    }

    // Check if token is expired
    const expiresAt = new Date(tokenData.expires_at)
    const now = new Date()
    const isExpired = now >= expiresAt

    if (isExpired) {
      // Try to refresh the token
      const { logger } = await import('./logging/logger')
      logger.logXeroSync(
        'token-refresh-attempt',
        `Attempting to refresh expired Xero token for tenant: ${tenantId}`,
        { tenantId }
      )
      
      const refreshedTokens = await refreshXeroToken(tokenData.refresh_token, tenantId)
      if (!refreshedTokens) {
        logger.logXeroSync(
          'token-refresh-failed',
          'Failed to refresh Xero token - authentication required',
          { 
            tenantId,
            reasons: [
              'Refresh token has expired (60 days)',
              'App has been disconnected by user', 
              'Refresh token has been revoked'
            ],
            action: 'User needs to re-authenticate with Xero'
          },
          'error'
        )
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
    const { logger } = await import('./logging/logger')
    logger.logXeroSync(
      'auth-client-error',
      'Error getting authenticated Xero client',
      { error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return null
  }
}

// Helper function to refresh Xero token
async function refreshXeroToken(refreshToken: string, tenantId?: string): Promise<{
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
  } catch (error: any) {
    const { logger } = await import('./logging/logger')
    logger.logXeroSync(
      'token-refresh-error',
      'Error refreshing Xero token',
      {
        tenantId,
        error: error.message,
        errorDetails: error?.response?.data,
        status: error?.response?.status,
        stack: error.stack
      },
      'error'
    )
    
    // Send critical alert to Sentry for token refresh failures
    try {
      const { captureMessage } = await import('@sentry/nextjs')
      captureMessage('🚨 CRITICAL: Xero token refresh failed - Re-authentication required', {
        level: 'error',
        tags: {
          integration: 'xero',
          operation: 'token_refresh',
          tenant_id: tenantId || 'unknown'
        },
        extra: {
          tenant_id: tenantId,
          error_type: error?.response?.data?.error || 'unknown',
          error_status: error?.response?.status,
          error_details: error?.response?.data,
          error_message: error?.message,
          possible_causes: [
            'Refresh token has expired (Demo Company: ~7-14 days, Production: ~60 days)',
            'App has been disconnected by user in Xero',
            'Refresh token has been revoked',
            'Invalid client credentials'
          ],
          action_required: 'User needs to re-authenticate with Xero via /admin/xero/connect'
        }
      })
    } catch (sentryError) {
      const { logger } = await import('./logging/logger')
      logger.logXeroSync(
        'sentry-alert-failed',
        'Failed to send Sentry alert for Xero token refresh failure',
        { 
          sentryError: sentryError instanceof Error ? sentryError.message : String(sentryError)
        },
        'error'
      )
    }
    
    return null
  }
}

// Helper function to revoke OAuth tokens on Xero's side
export async function revokeXeroTokens(): Promise<boolean> {
  try {
    const { createAdminClient } = await import('./supabase/server')
    const supabase = createAdminClient()

    // Get all active tokens
    const { data: activeTokens, error } = await supabase
      .from('xero_oauth_tokens')
      .select('access_token, refresh_token, tenant_id')
      .eq('is_active', true)

    if (error || !activeTokens || activeTokens.length === 0) {
      const { logger } = await import('./logging/logger')
      logger.logXeroSync(
        'no-tokens-to-revoke',
        'No active tokens to revoke',
        { tokenCount: 0 }
      )
      return true
    }

    // Revoke each token on Xero's side
    for (const token of activeTokens) {
      try {
        // Set the token on the client
        await xero.setTokenSet({
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          token_type: 'Bearer'
        })

        // Revoke the connection on Xero's side
        await xero.revokeToken()
        const { logger } = await import('./logging/logger')
        logger.logXeroSync(
          'token-revoked',
          'Successfully revoked token for tenant',
          { tenantId: token.tenant_id }
        )
        
      } catch (revokeError) {
        const { logger } = await import('./logging/logger')
        logger.logXeroSync(
          'token-revoke-error',
          'Error revoking token for tenant',
          { 
            tenantId: token.tenant_id,
            error: revokeError instanceof Error ? revokeError.message : String(revokeError)
          },
          'error'
        )
        // Continue with other tokens even if one fails
      }
    }

    return true
  } catch (error) {
    const { logger } = await import('./logging/logger')
    logger.logXeroSync(
      'revoke-tokens-error',
      'Error revoking Xero tokens',
      { error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return false
  }
}

// Helper function to get the single active tenant (single tenant model)
export async function getActiveTenant(): Promise<{
  tenant_id: string
  tenant_name: string
  expires_at: string
} | null> {
  try {
    const { createAdminClient } = await import('./supabase/server')
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('xero_oauth_tokens')
      .select('tenant_id, tenant_name, expires_at')
      .eq('is_active', true)
      .single()

    if (error) {
      const { logger } = await import('./logging/logger')
      logger.logXeroSync(
        'fetch-active-tenant-error',
        'Error fetching active Xero tenant',
        { error: error instanceof Error ? error.message : String(error) },
        'error'
      )
      return null
    }

    return data
  } catch (error) {
    const { logger } = await import('./logging/logger')
    logger.logXeroSync(
      'get-active-tenant-error',
      'Error getting active Xero tenant',
      { error: error instanceof Error ? error.message : String(error) },
      'error'
    )
    return null
  }
}

// Helper function to get all active tenants (kept for backward compatibility)
export async function getActiveXeroTenants(): Promise<Array<{
  tenant_id: string
  tenant_name: string
  expires_at: string
}>> {
  try {
    const { createAdminClient } = await import('./supabase/server')
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('xero_oauth_tokens')
      .select('tenant_id, tenant_name, expires_at')
      .eq('is_active', true)

    if (error) {
      const { logger } = await import('./logging/logger')
      logger.logXeroSync(
        'fetch-active-tenants-error',
        'Error fetching active Xero tenants',
        { error: error instanceof Error ? error.message : String(error) },
        'error'
      )
      return []
    }

    return data || []
  } catch (error) {
    const { logger } = await import('./logging/logger')
    logger.logXeroSync(
      'get-active-tenants-error',
      'Error getting active Xero tenants',
      { error: error instanceof Error ? error.message : String(error) },
      'error'
    )
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
    const { logger } = await import('./logging/logger')
    logger.logXeroSync(
      'validate-connection-error',
      'Error validating Xero connection',
      { 
        tenantId,
        error: error instanceof Error ? error.message : String(error)
      },
      'error'
    )
    return false
  }
}

// Helper function to log Xero sync operations (legacy format)
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
): Promise<void>

// Helper function to log Xero sync operations (new object format)
export async function logXeroSync(params: {
  operation: string
  tenant_id: string
  record_type: string
  record_id: string
  success: boolean
  xero_id?: string
  details?: string
  error_message?: string
}): Promise<void>

// Implementation
export async function logXeroSync(
  tenantIdOrParams: string | {
    operation: string
    tenant_id: string
    record_type: string
    record_id: string
    success: boolean
    xero_id?: string
    details?: string
    error_message?: string
  },
  operationType?: 'contact_sync' | 'invoice_sync' | 'payment_sync' | 'token_refresh',
  entityType?: 'user' | 'payment' | 'invoice' | 'contact' | null,
  entityId?: string | null,
  xeroEntityId?: string | null,
  status?: 'success' | 'error' | 'warning',
  errorCode?: string,
  errorMessage?: string,
  requestData?: any,
  responseData?: any
): Promise<void> {
  try {
    const { createAdminClient } = await import('./supabase/server')
    const supabase = createAdminClient()

    // Handle both calling patterns
    if (typeof tenantIdOrParams === 'object') {
      // New object format
      const params = tenantIdOrParams
      await supabase
        .from('xero_sync_logs')
        .insert({
          tenant_id: params.tenant_id,
          operation_type: params.operation,
          entity_type: params.record_type,
          entity_id: params.record_id,
          xero_entity_id: params.xero_id || null,
          status: params.success ? 'success' : 'error',
          error_message: params.error_message || null,
          request_data: null,
          response_data: params.details ? { details: params.details } : null
        })
    } else {
      // Legacy format
      await supabase
        .from('xero_sync_logs')
        .insert({
          tenant_id: tenantIdOrParams,
          operation_type: operationType!,
          entity_type: entityType,
          entity_id: entityId,
          xero_entity_id: xeroEntityId,
          status: status!,
          error_code: errorCode,
          error_message: errorMessage,
          request_data: requestData,
          response_data: responseData
        })
    }

    // Also log to Sentry for errors
    const isError = typeof tenantIdOrParams === 'object' 
      ? !tenantIdOrParams.success 
      : status === 'error'
    const errorMsg = typeof tenantIdOrParams === 'object' 
      ? tenantIdOrParams.error_message 
      : errorMessage
    const operation = typeof tenantIdOrParams === 'object' 
      ? tenantIdOrParams.operation 
      : operationType
    const tenantId = typeof tenantIdOrParams === 'object' 
      ? tenantIdOrParams.tenant_id 
      : tenantIdOrParams

    if (isError && errorMsg) {
      const { captureException } = await import('@sentry/nextjs')
      captureException(new Error(`Xero ${operation} failed: ${errorMsg}`), {
        extra: {
          tenantId,
          operation,
          errorMessage: errorMsg
        }
      })
    }
  } catch (error) {
    // Avoid circular logging - use console for logger errors
    console.error('Error logging Xero sync:', error)
  }
}