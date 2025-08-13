import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteParams {
  params: {
    paymentId: string
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient()
    
    // Check if user is authenticated and is admin
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify admin status
    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get registrations associated with this payment
    const { data: registrations, error: registrationsError } = await supabase
      .from('user_registrations')
      .select(`
        registration_id,
        registrations!inner (
          id,
          season_id,
          name,
          seasons!inner (
            id,
            name
          )
        )
      `)
      .eq('payment_id', params.paymentId)

    if (registrationsError) {
      console.error('Error fetching registrations for payment:', registrationsError)
      return NextResponse.json({ error: 'Failed to fetch registrations' }, { status: 500 })
    }

    return NextResponse.json({
      registrations: registrations || []
    })

  } catch (error) {
    console.error('Error in payment registrations API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}