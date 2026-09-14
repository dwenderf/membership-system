import { NextResponse } from 'next/server'
import { getAuthenticatedXeroClient } from '@/lib/xero/client'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

export async function POST() {
  try {
    const supabase = await createClient()

    // Get all active tenants
    const { data: activeTokens, error } = await supabase
      .from('xero_oauth_tokens')
      .select('tenant_id, tenant_name, expires_at')
      .eq('is_active', true)

    if (error || !activeTokens || activeTokens.length === 0) {
      logger.logXeroSync('keep-alive-no-tenants', 'No active Xero tenants to ping', {}, 'debug')
      return NextResponse.json({
        success: true, 
        message: 'No active tenants',
        tenants: []
      })
    }

    const results = []

    for (const token of activeTokens) {
      try {
        // Get authenticated client (this will refresh token if needed)
        const xeroApi = await getAuthenticatedXeroClient(token.tenant_id)

        if (!xeroApi) {
          logger.logXeroSync('keep-alive-auth-failed', 'Failed to get Xero client for tenant', { tenantId: token.tenant_id, tenantName: token.tenant_name }, 'warn')
          results.push({
            tenant_id: token.tenant_id,
            tenant_name: token.tenant_name,
            success: false,
            error: 'Failed to authenticate'
          })
          continue
        }

        // Make a lightweight API call - just get organisation info
        // NOTE: This makes a real Xero API call and should be used sparingly to avoid rate limiting
        const orgResponse = await xeroApi.accountingApi.getOrganisations(token.tenant_id)
        
        if (orgResponse?.body?.organisations && orgResponse.body.organisations.length > 0) {
          const org = orgResponse.body.organisations[0]
          logger.logXeroSync('keep-alive-ping-success', 'Xero ping successful', { tenantId: token.tenant_id, organisationName: org.name }, 'debug')

          results.push({
            tenant_id: token.tenant_id,
            tenant_name: token.tenant_name,
            success: true,
            organisation_name: org.name,
            expires_at: token.expires_at
          })
        } else {
          logger.logXeroSync('keep-alive-no-org-data', 'Xero ping returned no organisation data for tenant', { tenantId: token.tenant_id, tenantName: token.tenant_name }, 'warn')
          results.push({
            tenant_id: token.tenant_id,
            tenant_name: token.tenant_name,
            success: false,
            error: 'No organisation data returned'
          })
        }

      } catch (error) {
        logger.logXeroSync('keep-alive-ping-failed', 'Xero ping failed for tenant', { tenantId: token.tenant_id, tenantName: token.tenant_name, error: error instanceof Error ? error.message : String(error) }, 'error')
        results.push({
          tenant_id: token.tenant_id,
          tenant_name: token.tenant_name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    const successCount = results.filter(r => r.success).length
    const totalCount = results.length

    logger.logXeroSync('keep-alive-completed', `Xero keep-alive completed: ${successCount}/${totalCount} tenants successful`, { successCount, totalCount })

    return NextResponse.json({
      success: true,
      message: `Pinged ${totalCount} tenants, ${successCount} successful`,
      results: results,
      summary: {
        total: totalCount,
        successful: successCount,
        failed: totalCount - successCount
      }
    })

  } catch (error) {
    logger.logXeroSync('keep-alive-error', 'Xero keep-alive error', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// Also allow GET for manual testing
export async function GET() {
  return POST()
}