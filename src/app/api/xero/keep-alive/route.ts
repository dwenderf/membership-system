import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedXeroClient, withActiveTenant } from '@/lib/xero/client'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    console.log('🏓 Xero keep-alive ping started')
    
    const supabase = await createClient()
    
    // Get all active tenants
    const { data: activeTokens, error } = await supabase
      .from('xero_oauth_tokens')
      .select('tenant_id, tenant_name, expires_at')
      .eq('is_active', true)

    if (error || !activeTokens || activeTokens.length === 0) {
      console.log('No active Xero tenants to ping')
      return NextResponse.json({ 
        success: true, 
        message: 'No active tenants',
        tenants: []
      })
    }

    const results = []

    for (const token of activeTokens) {
      try {
        console.log(`🏓 Pinging Xero for tenant: ${token.tenant_name} (${token.tenant_id})`)
        
        // Get authenticated client (this will refresh token if needed)
        const xeroApi = await getAuthenticatedXeroClient(token.tenant_id)
        
        if (!xeroApi) {
          console.error(`❌ Failed to get Xero client for tenant: ${token.tenant_name}`)
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
          console.log(`✅ Xero ping successful for: ${org.name}`)
          
          results.push({
            tenant_id: token.tenant_id,
            tenant_name: token.tenant_name,
            success: true,
            organisation_name: org.name,
            expires_at: token.expires_at
          })
        } else {
          console.warn(`⚠️ Xero ping returned no organisation data for tenant: ${token.tenant_name}`)
          results.push({
            tenant_id: token.tenant_id,
            tenant_name: token.tenant_name,
            success: false,
            error: 'No organisation data returned'
          })
        }

      } catch (error) {
        console.error(`❌ Xero ping failed for tenant ${token.tenant_name}:`, error)
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

    console.log(`🏓 Xero keep-alive completed: ${successCount}/${totalCount} tenants successful`)

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
    console.error('❌ Xero keep-alive error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// Also allow GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request)
}