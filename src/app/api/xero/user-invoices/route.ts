import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // TODO: Get user's Xero contact ID
    // TODO: Fetch invoices from Xero API
    // TODO: Return formatted invoice data

    return NextResponse.json({
      invoices: []
    })

  } catch (error) {
    console.error('Error fetching user invoices:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch invoices' 
    }, { status: 500 })
  }
} 