import { XeroClient, AccountingApi } from 'xero-node'
import { Logger } from '@/lib/logging/logger'

const logger = Logger.getInstance()

if (!process.env.XERO_CLIENT_ID || !process.env.XERO_CLIENT_SECRET) {
  throw new Error('Missing Xero environment variables')
}

// Helper function to calculate refresh token expiration (60 days from last refresh)
export function calculateRefreshTokenExpiration(updatedAt: string): Date {
  return new Date(new Date(updatedAt).getTime() + (60 * 24 * 60 * 60 * 1000))
}

// Helper function to check if refresh token is expired
export function isRefreshTokenExpired(updatedAt: string): boolean {
  const refreshTokenExpiresAt = calculateRefreshTokenExpiration(updatedAt)
  const now = new Date()
  return now >= refreshTokenExpiresAt
}

// Run startup connection test when this module is first imported
// DISABLED: This was causing infinite loops and rate limiting when multiple
// instances of the module were imported simultaneously
let hasRunStartupTest = false

async function runXeroStartupTest() {
  if (hasRunStartupTest) return
  hasRunStartupTest = true

  // Only run on server side
  if (typeof window !== 'undefined') return

  const { logger } = await import('../logging/logger')
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
          const { logger } = await import('../logging/logger')
          logger.logXeroSync(
            'startup-connection-test',
            `Found ${activeXeroTenants.length} active Xero tenant(s), testing connection`,
            { tenantCount: activeXeroTenants.length, tenants: activeXeroTenants }
          )
          
          // Test connection to first active tenant
          logger.logXeroSync(
            'startup-connection-test-begin',
            `Testing connection to tenant: ${activeXeroTenants[0].tenant_name}`,
            { 
              tenantId: activeXeroTenants[0].tenant_id,
              tenantName: activeXeroTenants[0].tenant_name,
              tenantExpiresAt: activeXeroTenants[0].expires_at
            },
            'info'
          )
          
          const isConnected = await validateXeroConnection(activeXeroTenants[0].tenant_id)
          
          if (isConnected) {
            const { logger } = await import('../logging/logger')
            logger.logXeroSync(
              'startup-connection-success',
              `Xero connection verified for: ${activeXeroTenants[0].tenant_name}`,
              { tenantName: activeXeroTenants[0].tenant_name, tenantId: activeXeroTenants[0].tenant_id }
            )
          } else {
            const { logger } = await import('../logging/logger')
            logger.logXeroSync(
              'startup-connection-failed',
              `Xero connection test failed for: ${activeXeroTenants[0].tenant_name}`,
              { tenantName: activeXeroTenants[0].tenant_name, tenantId: activeXeroTenants[0].tenant_id },
              'warn'
            )
          }
        } else {
          const { logger } = await import('../logging/logger')
          logger.logXeroSync(
            'startup-no-tenants',
            'No active Xero tenants found at startup',
            { tenantCount: 0 },
            'warn'
          )
        }
      } catch (error) {
        const { logger } = await import('../logging/logger')
        logger.logXeroSync(
          'startup-test-error',
          'Xero startup test error',
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'warn'
        )
      }
    }, 2000) // 2 second delay to ensure everything is initialized
    
  } catch (error) {
    const { logger } = await import('../logging/logger')
    logger.logXeroSync(
      'startup-test-outer-error',
      'Error during Xero startup test',
      { error: error instanceof Error ? error.message : 'Unknown error' },
      'warn'
    )
  }
}

// Trigger startup test - DISABLED due to potential infinite loop causing rate limiting
// runXeroStartupTest()

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
    const { logger } = await import('../logging/logger')
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
export async function getAuthenticatedXeroClient(tenantId: string): Promise<XeroClient | null> {
  try {
    // Import dependencies here to avoid circular dependency
    const { createAdminClient } = await import('../supabase/server')
    const { logger } = await import('../logging/logger')
    const supabase = createAdminClient()

    // Get stored tokens for the tenant
    const { data: tokenData, error } = await supabase
      .from('xero_oauth_tokens')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single()

    // Debug logging for token retrieval
    logger.logXeroSync(
      'token-retrieval',
      'Retrieved token data from database',
      {
        tenantId,
        hasTokenData: !!tokenData,
        hasError: !!error,
        errorMessage: error?.message,
        tokenExpiresAt: tokenData?.expires_at,
        tokenUpdatedAt: tokenData?.updated_at,
        tokenCreatedAt: tokenData?.created_at
      },
      'info'
    )

    if (error || !tokenData) {
      logger.logXeroSync(
        'no-active-tokens',
        'No active Xero tokens found for tenant',
        { tenantId },
        'error'
      )
      return null
    }

    // Check if refresh token is expired (this determines if we can authenticate)
    const refreshTokenExpiresAt = calculateRefreshTokenExpiration(tokenData.updated_at)
    const now = new Date()
    const isRefreshTokenExpired = now >= refreshTokenExpiresAt

    // Check if access token is expired (this determines if we need to refresh)
    const accessTokenExpiresAt = new Date(tokenData.expires_at)
    const isAccessTokenExpired = now >= accessTokenExpiresAt

    // Debug logging for token expiry check
    logger.logXeroSync(
      'token-expiry-check',
      'Checking token expiry status',
      {
        tenantId,
        accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
        currentTime: now.toISOString(),
        accessTokenMinutesUntilExpiry: Math.floor((accessTokenExpiresAt.getTime() - now.getTime()) / (1000 * 60)),
        refreshTokenDaysUntilExpiry: Math.floor((refreshTokenExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        isAccessTokenExpired,
        isRefreshTokenExpired,
        tokenPrefix: tokenData.access_token.substring(0, 20) + '...'
      },
      'info'
    )

    // If refresh token is expired, we cannot authenticate
    if (isRefreshTokenExpired) {
      logger.logXeroSync(
        'refresh-token-expired',
        'Refresh token has expired - re-authentication required',
        { 
          tenantId,
          refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
          updated_at: tokenData.updated_at
        },
        'error'
      )
      
      // Deactivate the expired tokens
      await supabase
        .from('xero_oauth_tokens')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('tenant_id', tenantId)
      
      logger.logXeroSync(
        'token-deactivated',
        'Deactivated expired refresh tokens for tenant',
        { tenantId },
        'info'
      )
      
      return null
    }

    // Try to refresh the access token if it's expired (but refresh token is still valid)
    if (isAccessTokenExpired) {
      // Try to refresh the token
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
        
        // Deactivate the invalid tokens to prevent repeated refresh attempts
        await supabase
          .from('xero_oauth_tokens')
          .update({
            is_active: false,
            updated_at: new Date().toISOString()
          })
          .eq('tenant_id', tenantId)
        
        logger.logXeroSync(
          'token-deactivated',
          'Deactivated invalid Xero tokens for tenant',
          { tenantId },
          'info'
        )
        
        return null
      }

      // Update the stored tokens
      logger.logXeroSync(
        'token-update-attempt',
        'Updating refreshed tokens in database',
        { 
          tenantId,
          newExpiresAt: refreshedTokens.expires_at,
          newTokenPrefix: refreshedTokens.access_token.substring(0, 20) + '...'
        },
        'info'
      )

      const { error: updateError } = await supabase
        .from('xero_oauth_tokens')
        .update({
          access_token: refreshedTokens.access_token,
          refresh_token: refreshedTokens.refresh_token,
          expires_at: refreshedTokens.expires_at,
          updated_at: new Date().toISOString()
        })
        .eq('tenant_id', tenantId)

      if (updateError) {
        logger.logXeroSync(
          'token-update-failed',
          'Failed to update refreshed tokens in database',
          { 
            tenantId,
            error: updateError.message
          },
          'error'
        )
        throw new Error(`Failed to update tokens: ${updateError.message}`)
      }

      logger.logXeroSync(
        'token-update-success',
        'Successfully updated refreshed tokens in database',
        { tenantId },
        'info'
      )

      // Set the new token on the client
      await xero.setTokenSet({
        access_token: refreshedTokens.access_token,
        refresh_token: refreshedTokens.refresh_token,
        expires_at: Math.floor(new Date(refreshedTokens.expires_at).getTime() / 1000),
        token_type: 'Bearer',
        scope: tokenData.scope
      })
    } else {
      // Token is still valid, use it
      await xero.setTokenSet({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Math.floor(new Date(tokenData.expires_at).getTime() / 1000),
        token_type: tokenData.token_type,
        scope: tokenData.scope
      })
    }

    return xero

  } catch (error) {
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

    // Log what Xero actually returned for debugging
    const { logger } = await import('../logging/logger')
    logger.logXeroSync(
      'token-refresh-response',
      'Xero token refresh response details',
      {
        tenantId,
        hasAccessToken: !!refreshedTokenSet.access_token,
        hasRefreshToken: !!refreshedTokenSet.refresh_token,
        hasIdToken: !!refreshedTokenSet.id_token,
        expiresAt: refreshedTokenSet.expires_at,
        tokenType: refreshedTokenSet.token_type
      },
      'info'
    )

    // Xero should always return a new refresh token when refreshing
    // If it doesn't, this indicates an error condition
    if (!refreshedTokenSet.refresh_token) {
      logger.logXeroSync(
        'token-refresh-missing-refresh-token',
        'Xero did not return a new refresh token - this may indicate an authentication issue',
        { tenantId, oldRefreshTokenPrefix: refreshToken.substring(0, 10) + '...' },
        'warn'
      )
      return null // Force re-authentication rather than using invalid token
    }

    return {
      access_token: refreshedTokenSet.access_token,
      refresh_token: refreshedTokenSet.refresh_token, // Always use the new refresh token
      expires_at: refreshedTokenSet.expires_at 
        ? new Date(refreshedTokenSet.expires_at * 1000).toISOString() // Convert Unix timestamp to ISO string
        : new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes from now
    }
  } catch (error: any) {
    const { logger } = await import('../logging/logger')
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
      const { logger } = await import('../logging/logger')
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
    const { createAdminClient } = await import('../supabase/server')
    const supabase = createAdminClient()

    // Get all active tokens
    const { data: activeTokens, error } = await supabase
      .from('xero_oauth_tokens')
      .select('access_token, refresh_token, tenant_id')
      .eq('is_active', true)

    if (error || !activeTokens || activeTokens.length === 0) {
      const { logger } = await import('../logging/logger')
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
        // Create a fresh XeroClient instance for revocation
        const revokeClient = new XeroClient({
          clientId: process.env.XERO_CLIENT_ID!,
          clientSecret: process.env.XERO_CLIENT_SECRET!,
          redirectUris: [process.env.XERO_REDIRECT_URI || 'http://localhost:3000/api/xero/callback'],
          scopes: process.env.XERO_SCOPES?.split(' ') || [
            'accounting.transactions',
            'accounting.contacts',
            'accounting.settings',
            'offline_access'
          ]
        })

        // Set the token on the client
        await revokeClient.setTokenSet({
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          token_type: 'Bearer'
        })

        // Revoke the connection on Xero's side using OAuth2 revocation endpoint
        try {
          // Xero uses the standard OAuth2 revocation endpoint
          const revocationUrl = 'https://identity.xero.com/connect/revocation'
          
          const response = await fetch(revocationUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')}`
            },
            body: new URLSearchParams({
              token: token.access_token,
              token_type_hint: 'access_token'
            })
          })

          if (response.ok) {
            const { logger } = await import('../logging/logger')
            logger.logXeroSync(
              'token-revoked',
              'Successfully revoked access token for tenant',
              { tenantId: token.tenant_id }
            )
          } else {
            console.warn(`Token revocation failed with status ${response.status}`)
          }

          // Also try to revoke the refresh token
          const refreshResponse = await fetch(revocationUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')}`
            },
            body: new URLSearchParams({
              token: token.refresh_token,
              token_type_hint: 'refresh_token'
            })
          })

          if (refreshResponse.ok) {
            const { logger } = await import('../logging/logger')
            logger.logXeroSync(
              'refresh-token-revoked',
              'Successfully revoked refresh token for tenant',
              { tenantId: token.tenant_id }
            )
          } else {
            console.warn(`Refresh token revocation failed with status ${refreshResponse.status}`)
          }
        } catch (revokeMethodError) {
          console.warn('Token revocation method failed, but continuing:', revokeMethodError)
        }

        const { logger } = await import('../logging/logger')
        logger.logXeroSync(
          'token-revoked',
          'Successfully revoked token for tenant',
          { tenantId: token.tenant_id }
        )
        
      } catch (revokeError) {
        const { logger } = await import('../logging/logger')
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
    const { logger } = await import('../logging/logger')
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
    const { createAdminClient } = await import('../supabase/server')
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('xero_oauth_tokens')
      .select('tenant_id, tenant_name, expires_at')
      .eq('is_active', true)
      .single()

    if (error) {
      const { logger } = await import('../logging/logger')
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
    const { logger } = await import('../logging/logger')
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
    const { createAdminClient } = await import('../supabase/server')
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('xero_oauth_tokens')
      .select('tenant_id, tenant_name, expires_at')
      .eq('is_active', true)

    if (error) {
      const { logger } = await import('../logging/logger')
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
    const { logger } = await import('../logging/logger')
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
    const response = await xeroApi.accountingApi.getOrganisations(tenantId)
    return !!(response.body.organisations && response.body.organisations.length > 0)
  } catch (error) {
    const { logger } = await import('../logging/logger')
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
  response_data?: any
  request_data?: any
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
    response_data?: any
    request_data?: any
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
    const { createAdminClient } = await import('../supabase/server')
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
          request_data: params.request_data || null,
          response_data: params.response_data || (params.details ? { details: params.details } : null)
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