import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

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
            last_name,
            is_lgbtq,
            is_goalie
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
        logger.logSystem('registration-reports-api', 'Error fetching registration data', { error: registrationError, registrationId }, 'error')
        return NextResponse.json({ error: 'Failed to fetch registration data' }, { status: 500 })
      }

      // Get waitlist details for this registration
      const { data: waitlistData, error: waitlistError } = await adminSupabase
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
            stripe_payment_method_id,
            setup_intent_status
          ),
          registration_categories (
            id,
            custom_name,
            price,
            categories (
              name
            )
          ),
          discount_codes (
            id,
            code,
            percentage
          )
        `)
        .eq('registration_id', registrationId)
        .is('removed_at', null)
        .order('position', { ascending: true })

      if (waitlistError) {
        logger.logSystem('registration-reports-api', 'Error fetching waitlist data', { error: waitlistError, registrationId }, 'error')
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
          category_id: item.registration_category_id || 'unknown',
          registration_category_name: registrationCategory?.custom_name || category?.name || 'Unknown Category',
          payment_status: item.payment_status || 'Unknown',
          amount_paid: item.amount_paid || 0,
          registered_at: item.registered_at,
          registration_fee: item.registration_fee || 0,
          presale_code_used: item.presale_code_used,
          is_lgbtq: user?.is_lgbtq,
          is_goalie: user?.is_goalie || false
        }
      }) || []

      // Process waitlist data
      const processedWaitlistData = waitlistData?.map(item => {
        const user = Array.isArray(item.users) ? item.users[0] : item.users
        const registrationCategory = Array.isArray(item.registration_categories) ? item.registration_categories[0] : item.registration_categories
        const category = registrationCategory?.categories ? (Array.isArray(registrationCategory.categories) ? registrationCategory.categories[0] : registrationCategory.categories) : null
        const discountCode = Array.isArray(item.discount_codes) ? item.discount_codes[0] : item.discount_codes

        // Calculate pricing
        const basePrice = registrationCategory?.price || 0
        const discountAmount = discountCode ? Math.round((basePrice * discountCode.percentage) / 100) : 0
        const finalAmount = Math.max(0, basePrice - discountAmount)

        // Check payment method status
        const hasValidPaymentMethod = user?.stripe_payment_method_id && user?.setup_intent_status === 'succeeded'

        return {
          id: item.id,
          user_id: user?.id || 'Unknown',
          first_name: user?.first_name || '',
          last_name: user?.last_name || '',
          email: user?.email || 'Unknown',
          category_name: category?.name || registrationCategory?.custom_name || 'Unknown Category',
          category_id: item.registration_category_id,
          position: item.position,
          joined_at: item.joined_at,
          is_lgbtq: user?.is_lgbtq,
          is_goalie: user?.is_goalie || false,
          hasValidPaymentMethod,
          discount_code_id: discountCode?.id || null,
          discount_code: discountCode?.code || null,
          discount_percentage: discountCode?.percentage || null,
          base_price: basePrice,
          discount_amount: discountAmount,
          final_amount: finalAmount
        }
      }) || []

      return NextResponse.json({ 
        data: processedData,
        waitlistData: processedWaitlistData 
      })
    } else {
      // Get all registrations for selection with category counts
      const { data: registrationsList, error: registrationsError } = await adminSupabase
        .from('registrations')
        .select(`
          id, 
          name, 
          type,
          seasons (
            name
          ),
          registration_categories (
            id,
            custom_name,
            max_capacity,
            categories (
              name
            )
          )
        `)
        .eq('is_active', true)
        .order('name')

      if (registrationsError) {
        logger.logSystem('registration-reports-api', 'Error fetching registrations list', { error: registrationsError }, 'error')
        return NextResponse.json({ error: 'Failed to fetch registrations list' }, { status: 500 })
      }

      // Get registration counts for each registration/category combination
      const registrationIds = registrationsList?.map(r => r.id) || []
      
      const { data: registrationCounts, error: countsError } = await adminSupabase
        .from('user_registrations')
        .select('registration_id, registration_category_id, payment_status')
        .in('registration_id', registrationIds)
        .in('payment_status', ['paid', 'processing', 'awaiting_payment'])

      if (countsError) {
        logger.logSystem('registration-reports-api', 'Error fetching registration counts', { error: countsError }, 'error')
      }

      // Get waitlist counts for each registration
      const { data: waitlistCounts, error: waitlistError } = await adminSupabase
        .from('waitlists')
        .select('registration_id, registration_category_id')
        .in('registration_id', registrationIds)
        .is('removed_at', null)

      if (waitlistError) {
        logger.logSystem('registration-reports-api', 'Error fetching waitlist counts', { error: waitlistError }, 'error')
      }

      // Create a map of registration counts by registration_id and category_id
      const countsMap = new Map<string, Map<string, number>>()
      registrationCounts?.forEach(count => {
        const regId = count.registration_id
        const catId = count.registration_category_id || 'no-category'
        
        if (!countsMap.has(regId)) {
          countsMap.set(regId, new Map())
        }
        
        const regMap = countsMap.get(regId)!
        regMap.set(catId, (regMap.get(catId) || 0) + 1)
      })

      // Create a map of waitlist counts by registration_id and category_id
      const waitlistMap = new Map<string, Map<string, number>>()
      waitlistCounts?.forEach(count => {
        const regId = count.registration_id
        const catId = count.registration_category_id || 'no-category'
        
        if (!waitlistMap.has(regId)) {
          waitlistMap.set(regId, new Map())
        }
        
        const regMap = waitlistMap.get(regId)!
        regMap.set(catId, (regMap.get(catId) || 0) + 1)
      })

      // Process the data to flatten the structure and add counts
      const processedRegistrations = registrationsList?.map(item => {
        const season = Array.isArray(item.seasons) ? item.seasons[0] : item.seasons
        const categories = Array.isArray(item.registration_categories) ? item.registration_categories : (item.registration_categories ? [item.registration_categories] : [])
        
        // Calculate category breakdown with counts and waitlist counts
        const categoryBreakdown = categories.map(cat => {
          const category = Array.isArray(cat.categories) ? cat.categories[0] : cat.categories
          const categoryId = cat.id
          const registrationCounts = countsMap.get(item.id)
          const waitlistCounts = waitlistMap.get(item.id)
          const count = registrationCounts?.get(categoryId) || 0
          const waitlistCount = waitlistCounts?.get(categoryId) || 0
          
          return {
            id: categoryId,
            name: category?.name || cat.custom_name || 'Unknown Category',
            count: count,
            waitlist_count: waitlistCount,
            max_capacity: cat.max_capacity,
            percentage_full: cat.max_capacity ? Math.round((count / cat.max_capacity) * 100) : null
          }
        })

        // Calculate total count and waitlist count across all categories
        const totalCount = categoryBreakdown.reduce((sum, cat) => sum + cat.count, 0)
        const totalCapacity = categoryBreakdown.reduce((sum, cat) => sum + (cat.max_capacity || 0), 0)
        const totalWaitlistCount = categoryBreakdown.reduce((sum, cat) => sum + cat.waitlist_count, 0)

        return {
          id: item.id,
          name: item.name,
          type: item.type,
          season_name: season?.name || 'Unknown Season',
          total_count: totalCount,
          total_capacity: totalCapacity > 0 ? totalCapacity : null,
          total_waitlist_count: totalWaitlistCount,
          category_breakdown: categoryBreakdown
        }
      }) || []

      return NextResponse.json({ data: processedRegistrations })
    }
  } catch (error) {
    logger.logSystem('registration-reports-api', 'Error in registration reports API', { error }, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}