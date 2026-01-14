import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's paid registrations only (exclude refunded, processing, awaiting_payment, failed)
    const { data: userRegistrations, error } = await supabase
      .from('user_registrations')
      .select(`
        *,
        registration:registrations(
          id,
          name,
          type,
          start_date,
          end_date,
          season:seasons(id, name, start_date, end_date)
        ),
        registration_category:registration_categories(
          *,
          categories:category_id(name, description)
        )
      `)
      .eq('user_id', user.id)
      .eq('payment_status', 'paid')
      .order('registered_at', { ascending: false })

    if (error) {
      console.error('Error fetching user registrations:', error)
      return NextResponse.json({ error: 'Failed to fetch registrations' }, { status: 500 })
    }

    return NextResponse.json(userRegistrations || [])

  } catch (error) {
    console.error('Error in user registrations API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}