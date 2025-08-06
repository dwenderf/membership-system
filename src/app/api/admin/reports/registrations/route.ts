import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Logger } from '@/lib/logging/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    
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

    // Get registration ID from query params
    const registrationId = searchParams.get('registrationId')

    // Use admin client to access the secured view
    const adminSupabase = await createAdminClient()

    if (registrationId) {
      // Get specific registration data with user details
      // Join with user_registrations and users to get participant details
      const { data: registrationData, error: registrationError } = await adminSupabase
        .from('user_registrations')
        .select(`
          *,
          users!inner (
            id,
            email,
            first_name,
            last_name
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
            price,
            categories (
              name
            )
          )
        `)
        .eq('registration_id', registrationId)
        .order('registered_at', { ascending: false })

      if (registrationError) {
        Logger.error('Error fetching registration data:', { error: registrationError, registrationId })
        return NextResponse.json({ error: 'Failed to fetch registration data' }, { status: 500 })
      }

      // Process the data to flatten the structure for the frontend
      const processedData = registrationData?.map(item => {
        const user = Array.isArray(item.users) ? item.users[0] : item.users
        const registration = Array.isArray(item.registrations) ? item.registrations[0] : item.registrations
        const registrationCategory = Array.isArray(item.registration_categories) ? item.registration_categories[0] : item.registration_categories
        const season = registration?.seasons ? (Array.isArray(registration.seasons) ? registration.seasons[0] : registration.seasons) : null
        const category = registrationCategory?.categories ? (Array.isArray(registrationCategory.categories) ? registrationCategory.categories[0] : registrationCategory.categories) : null

        return {
          registration_id: item.registration_id,
          registration_name: registration?.name || 'Unknown Registration',
          season_name: season?.name || 'Unknown Season',
          registration_type: registration?.type || 'Unknown',
          user_id: user?.id || 'Unknown',
          first_name: user?.first_name || '',
          last_name: user?.last_name || '',
          email: user?.email || 'Unknown',
          category_name: category?.name || registrationCategory?.custom_name || 'Unknown Category',
          registration_category_name: registrationCategory?.custom_name || category?.name || 'Unknown Category',
          payment_status: item.payment_status || 'Unknown',
          amount_paid: item.amount_paid || 0,
          registered_at: item.registered_at,
          registration_fee: item.registration_fee || 0,
          presale_code_used: item.presale_code_used
        }
      }) || []

      return NextResponse.json({ data: processedData })
    } else {
      // Get all registrations for selection
      const { data: registrationsList, error: registrationsError } = await adminSupabase
        .from('registrations')
        .select(`
          id, 
          name, 
          type,
          seasons (
            name
          )
        `)
        .eq('is_active', true)
        .order('name')

      if (registrationsError) {
        Logger.error('Error fetching registrations list:', { error: registrationsError })
        return NextResponse.json({ error: 'Failed to fetch registrations list' }, { status: 500 })
      }

      // Process the data to flatten the structure
      const processedRegistrations = registrationsList?.map(item => {
        const season = Array.isArray(item.seasons) ? item.seasons[0] : item.seasons
        return {
          id: item.id,
          name: item.name,
          type: item.type,
          season_name: season?.name || 'Unknown Season'
        }
      }) || []

      return NextResponse.json({ data: processedRegistrations })
    }
  } catch (error) {
    Logger.error('Error in registration reports API:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}