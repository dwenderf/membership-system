import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const registrationId = params.id

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is a captain of this registration
    const { data: captainship, error: captainError } = await supabase
      .from('registration_captains')
      .select('id')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .single()

    if (captainError || !captainship) {
      return NextResponse.json(
        { error: 'You are not a captain of this registration' },
        { status: 403 }
      )
    }

    // Get registration data with user details (captains can access via RLS)
    const { data: registrationData, error: registrationError } = await supabase
      .from('user_registrations')
      .select(`
        *,
        users!inner (
          id,
          email,
          first_name,
          last_name,
          member_id,
          is_lgbtq,
          is_goalie,
          phone
        ),
        registrations!inner (
          id,
          name,
          type,
          seasons (
            name
          )
        ),
        registration_categories (
          id,
          custom_name,
          categories (
            name
          )
        )
      `)
      .eq('registration_id', registrationId)
      .order('registered_at', { ascending: false })

    if (registrationError) {
      console.error('Error fetching registration data:', registrationError)
      return NextResponse.json(
        { error: 'Failed to fetch registration data' },
        { status: 500 }
      )
    }

    // Get waitlist details for this registration
    const { data: waitlistData, error: waitlistError } = await supabase
      .from('waitlists')
      .select(`
        *,
        users!waitlists_user_id_fkey (
          id,
          email,
          first_name,
          last_name,
          is_lgbtq,
          is_goalie,
          phone
        ),
        registration_categories (
          id,
          custom_name,
          categories (
            name
          )
        )
      `)
      .eq('registration_id', registrationId)
      .is('removed_at', null)
      .order('position', { ascending: true })

    if (waitlistError) {
      console.error('Error fetching waitlist data:', waitlistError)
    }

    // Process the registration data to flatten structure
    const processedData = registrationData?.map(item => {
      const user = Array.isArray(item.users) ? item.users[0] : item.users
      const registration = Array.isArray(item.registrations) ? item.registrations[0] : item.registrations
      const registrationCategory = Array.isArray(item.registration_categories) ? item.registration_categories[0] : item.registration_categories
      const season = registration?.seasons ? (Array.isArray(registration.seasons) ? registration.seasons[0] : registration.seasons) : null
      const category = registrationCategory?.categories ? (Array.isArray(registrationCategory.categories) ? registrationCategory.categories[0] : registrationCategory.categories) : null

      return {
        id: item.id,
        registration_id: item.registration_id,
        registration_name: registration?.name || 'Unknown Registration',
        season_name: season?.name || 'Unknown Season',
        registration_type: registration?.type || 'Unknown',
        user_id: user?.id || 'Unknown',
        first_name: user?.first_name || '',
        last_name: user?.last_name || '',
        member_id: user?.member_id || null,
        email: user?.email || 'Unknown',
        phone: user?.phone || null,
        category_name: category?.name || registrationCategory?.custom_name || 'Unknown Category',
        category_id: item.registration_category_id || 'unknown',
        payment_status: item.payment_status || 'Unknown',
        registered_at: item.registered_at,
        is_lgbtq: user?.is_lgbtq,
        is_goalie: user?.is_goalie || false,
      }
    }) || []

    // Process waitlist data
    const processedWaitlistData = waitlistData?.map(item => {
      const user = Array.isArray(item.users) ? item.users[0] : item.users
      const registrationCategory = Array.isArray(item.registration_categories) ? item.registration_categories[0] : item.registration_categories
      const category = registrationCategory?.categories ? (Array.isArray(registrationCategory.categories) ? registrationCategory.categories[0] : registrationCategory.categories) : null

      return {
        id: item.id,
        user_id: item.user_id,
        first_name: user?.first_name || '',
        last_name: user?.last_name || '',
        email: user?.email || '',
        phone: user?.phone || null,
        category_name: category?.name || registrationCategory?.custom_name || 'Unknown Category',
        category_id: item.registration_category_id || 'unknown',
        position: item.position,
        joined_at: item.joined_at,
        is_lgbtq: user?.is_lgbtq,
        is_goalie: user?.is_goalie || false,
      }
    }) || []

    return NextResponse.json({
      data: processedData,
      waitlistData: processedWaitlistData,
    })
  } catch (error) {
    console.error('Error in captain roster API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
