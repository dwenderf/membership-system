import { NextRequest, NextResponse } from 'next/server'
import { createXeroOAuthClient, logXeroSync, revokeXeroTokens } from '@/lib/xero/client'
import { createClient } from '@/lib/supabase/server'
import { readXeroOAuthStateCookie, clearXeroOAuthStateCookie } from '@/lib/xero/oauth-state'

function redirectAndClearState(request: NextRequest, pathAndQuery: string) {
  const response = NextResponse.redirect(new URL(pathAndQuery, request.url))
  clearXeroOAuthStateCookie(response)
  return response
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const error = searchParams.get('error')
    const returnedState = searchParams.get('state')

    // Handle OAuth errors
    if (error) {
      console.error('Xero OAuth error:', error)
      return redirectAndClearState(request, '/admin/accounting/xero?xero_error=' + encodeURIComponent(error))
    }

    // Validate the CSRF state token before touching the code or calling Xero
    const expectedState = readXeroOAuthStateCookie(request)
    if (!expectedState) {
      console.error('Xero OAuth callback missing state cookie (expired or direct navigation)')
      return redirectAndClearState(request, '/admin/accounting/xero?xero_error=missing_state')
    }
    if (!returnedState || returnedState !== expectedState) {
      console.error('Xero OAuth callback state mismatch — possible CSRF attempt')
      return redirectAndClearState(request, '/admin/accounting/xero?xero_error=state_mismatch')
    }

    if (!code) {
      console.error('No authorization code received from Xero')
      return redirectAndClearState(request, '/admin/accounting/xero?xero_error=no_code')
    }

    // Exchange code for tokens using a request-scoped client seeded with the
    // already-validated state, so the library's own internal check also passes
    const oauthClient = createXeroOAuthClient(expectedState)
    const tokenSet = await oauthClient.apiCallback(request.url)

    if (!tokenSet || !tokenSet.access_token) {
      console.error('Failed to exchange code for tokens')
      return redirectAndClearState(request, '/admin/accounting/xero?xero_error=token_exchange_failed')
    }

    // Get tenant connections
    const tenantConnections = await oauthClient.updateTenants(true)

    if (!tenantConnections || tenantConnections.length === 0) {
      console.error('No tenant connections found')
      return redirectAndClearState(request, '/admin/accounting/xero?xero_error=no_tenants')
    }

    // First, revoke existing OAuth connections on Xero's side (single tenant model)
    console.log('Revoking existing Xero OAuth connections...')
    await revokeXeroTokens()

    // Then disconnect any existing active connections in our database
    const { error: deactivateError } = await supabase
      .from('xero_oauth_tokens')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('is_active', true)

    if (deactivateError) {
      console.error('Error deactivating existing Xero tokens:', deactivateError)
    }

    // Store tokens for each tenant
    const storedTenants = []
    for (const tenant of tenantConnections) {
      try {
        // Calculate expiration time
        const expiresAt = new Date(Date.now() + (tokenSet.expires_in || 1800) * 1000)

        // Store or update the token (handle case where record exists but is inactive)
        const { data: existingToken } = await supabase
          .from('xero_oauth_tokens')
          .select('id')
          .eq('tenant_id', tenant.tenantId)
          .single()

        let tokenError = null

        if (existingToken) {
          // Update existing token
          const { error: updateError } = await supabase
            .from('xero_oauth_tokens')
            .update({
              tenant_name: tenant.tenantName,
              access_token: tokenSet.access_token,
              refresh_token: tokenSet.refresh_token,
              id_token: tokenSet.id_token,
              expires_at: expiresAt.toISOString(),
              scope: tokenSet.scope,
              token_type: tokenSet.token_type || 'Bearer',
              is_active: true,
              updated_at: new Date().toISOString()
            })
            .eq('tenant_id', tenant.tenantId)

          tokenError = updateError
        } else {
          // Insert new token
          const { error: insertError } = await supabase
            .from('xero_oauth_tokens')
            .insert({
              tenant_id: tenant.tenantId,
              tenant_name: tenant.tenantName,
              access_token: tokenSet.access_token,
              refresh_token: tokenSet.refresh_token,
              id_token: tokenSet.id_token,
              expires_at: expiresAt.toISOString(),
              scope: tokenSet.scope,
              token_type: tokenSet.token_type || 'Bearer',
              is_active: true
            })

          tokenError = insertError
        }

        if (tokenError) {
          console.error('Error storing Xero token:', tokenError)
          continue
        }

        storedTenants.push(tenant.tenantName)

        // Log successful token storage
        await logXeroSync(
          tenant.tenantId,
          'token_refresh',
          null,
          null,
          null,
          'success',
          undefined,
          'OAuth tokens stored successfully'
        )

      } catch (error) {
        console.error('Error processing tenant:', tenant.tenantId, error)
        await logXeroSync(
          tenant.tenantId,
          'token_refresh',
          null,
          null,
          null,
          'error',
          'token_storage_failed',
          error instanceof Error ? error.message : 'Unknown error'
        )
      }
    }

    if (storedTenants.length === 0) {
      return redirectAndClearState(request, '/admin/accounting/xero?xero_error=token_storage_failed')
    }

    // Success redirect
    return redirectAndClearState(
      request,
      '/admin/accounting/xero?xero_success=connected&tenants=' + encodeURIComponent(storedTenants.join(','))
    )

  } catch (error) {
    console.error('Error in Xero OAuth callback:', error)
    return redirectAndClearState(request, '/admin/accounting/xero?xero_error=callback_failed')
  }
}