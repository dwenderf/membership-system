import { NextRequest, NextResponse } from 'next/server'
import { xero } from '@/lib/xero/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
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

    // Generate OAuth URL
    const consentUrl = await xero.buildConsentUrl()
    
    if (!consentUrl) {
      return NextResponse.json({ error: 'Failed to generate consent URL' }, { status: 500 })
    }

    // Return the consent URL for the frontend to redirect to
    return NextResponse.json({ 
      consentUrl,
      message: 'Redirect to this URL to authorize Xero integration' 
    })

  } catch (error) {
    console.error('Error initiating Xero OAuth:', error)
    return NextResponse.json({ 
      error: 'Failed to initiate Xero authorization' 
    }, { status: 500 })
  }
}