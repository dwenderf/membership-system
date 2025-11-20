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

    // Test if we can reach Xero's discovery endpoint
    const discoveryUrl = 'https://identity.xero.com/.well-known/openid-configuration'

    try {
      const response = await fetch(discoveryUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      })

      const data = await response.json()

      return NextResponse.json({
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        canReachXero: response.ok,
        discoveryUrl,
        issuer: data.issuer,
        authorizationEndpoint: data.authorization_endpoint,
        tokenEndpoint: data.token_endpoint,
        hasRequiredEndpoints: !!(data.authorization_endpoint && data.token_endpoint)
      })
    } catch (fetchError) {
      return NextResponse.json({
        success: false,
        canReachXero: false,
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        discoveryUrl
      }, { status: 500 })
    }
  } catch (error) {
    console.error('Error testing Xero discovery:', error)
    return NextResponse.json({
      error: 'Failed to test Xero discovery',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
