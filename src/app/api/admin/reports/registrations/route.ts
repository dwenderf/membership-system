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
            member_id,
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
          ),
          payments (
            id,
            xero_invoices (
              invoice_number
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
            percentage,
            category:discount_categories (
              id,
              name,
              max_discount_per_user_per_season
            )
          )
        `)
        .eq('registration_id', registrationId)
        .is('removed_at', null)
        .order('position', { ascending: true })

      if (waitlistError) {
        logger.logSystem('registration-reports-api', 'Error fetching waitlist data', { error: waitlistError, registrationId }, 'error')
      }

      // Get ALL users who registered as alternates for this registration
      const { data: userAlternateRegistrations, error: userAlternatesError } = await adminSupabase
        .from('user_alternate_registrations')
        .select(`
          id,
          user_id,
          registration_id,
          discount_code_id,
          created_at,
          users!inner (
            id,
            email,
            first_name,
            last_name,
            is_lgbtq,
            is_goalie
          )
        `)
        .eq('registration_id', registrationId)

      if (userAlternatesError) {
        logger.logSystem('registration-reports-api', 'Error fetching user alternates', { error: userAlternatesError, registrationId }, 'error')
      }

      // Get alternate selections for this registration to calculate times_played and total_paid
      const { data: alternateSelectionsData, error: alternatesError } = await adminSupabase
        .from('alternate_selections')
        .select(`
          *,
          users!alternate_selections_user_id_fkey (
            id
          ),
          alternate_registrations!inner (
            id,
            registration_id,
            game_description,
            game_date
          )
        `)
        .eq('alternate_registrations.registration_id', registrationId)
        .order('selected_at', { ascending: false })

      if (alternatesError) {
        logger.logSystem('registration-reports-api', 'Error fetching alternates selections data', { error: alternatesError, registrationId }, 'error')
      }

      // Get discount usage for waitlist users to check seasonal limits
      const waitlistUserIds = waitlistData?.map(w => {
        const user = Array.isArray(w.users) ? w.users[0] : w.users
        return user?.id
      }).filter(Boolean) || []

      const { data: discountUsageData } = await adminSupabase
        .from('discount_usage')
        .select('user_id, discount_category_id, amount_saved')
        .in('user_id', waitlistUserIds)

      // Group usage by user and category
      const usageByUserAndCategory = new Map()
      discountUsageData?.forEach(usage => {
        const key = `${usage.user_id}-${usage.discount_category_id}`
        const current = usageByUserAndCategory.get(key) || 0
        usageByUserAndCategory.set(key, current + usage.amount_saved)
      })

      // Process the data to flatten the structure for the frontend
      const processedData = registrationData?.map(item => {
        const user = Array.isArray(item.users) ? item.users[0] : item.users
        const registration = Array.isArray(item.registrations) ? item.registrations[0] : item.registrations
        const registrationCategory = Array.isArray(item.registration_categories) ? item.registration_categories[0] : item.registration_categories
        const season = registration?.seasons ? (Array.isArray(registration.seasons) ? registration.seasons[0] : registration.seasons) : null
        const category = registrationCategory?.categories ? (Array.isArray(registrationCategory.categories) ? registrationCategory.categories[0] : registrationCategory.categories) : null
        const payment = Array.isArray(item.payments) ? item.payments[0] : item.payments
        const xeroInvoice = payment?.xero_invoices ? (Array.isArray(payment.xero_invoices) ? payment.xero_invoices[0] : payment.xero_invoices) : null

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
          category_name: category?.name || registrationCategory?.custom_name || 'Unknown Category',
          category_id: item.registration_category_id || 'unknown',
          registration_category_name: registrationCategory?.custom_name || category?.name || 'Unknown Category',
          payment_status: item.payment_status || 'Unknown',
          amount_paid: item.amount_paid || 0,
          registered_at: item.registered_at,
          registration_fee: item.registration_fee || 0,
          presale_code_used: item.presale_code_used,
          is_lgbtq: user?.is_lgbtq,
          is_goalie: user?.is_goalie || false,
          payment_id: item.payment_id || null,
          invoice_number: xeroInvoice?.invoice_number || null
        }
      }) || []

      // Process waitlist data
      const processedWaitlistData = waitlistData?.map(item => {
        const user = Array.isArray(item.users) ? item.users[0] : item.users
        const registrationCategory = Array.isArray(item.registration_categories) ? item.registration_categories[0] : item.registration_categories
        const category = registrationCategory?.categories ? (Array.isArray(registrationCategory.categories) ? registrationCategory.categories[0] : registrationCategory.categories) : null
        const discountCode = Array.isArray(item.discount_codes) ? item.discount_codes[0] : item.discount_codes

        // Calculate pricing with seasonal cap enforcement
        const basePrice = registrationCategory?.price || 0
        let discountAmount = 0

        if (discountCode) {
          // Calculate requested discount amount
          let requestedDiscountAmount = Math.round((basePrice * discountCode.percentage) / 100)

          // Check and apply seasonal cap
          const discountCategory = Array.isArray(discountCode.category) ? discountCode.category[0] : discountCode.category
          if (discountCategory && discountCategory.max_discount_per_user_per_season) {
            const usageKey = `${user?.id}-${discountCategory.id}`
            const currentUsage = usageByUserAndCategory.get(usageKey) || 0
            const limit = discountCategory.max_discount_per_user_per_season
            const remainingAmount = Math.max(0, limit - currentUsage)

            // Apply cap - use remaining amount if would exceed
            if (currentUsage + requestedDiscountAmount > limit) {
              discountAmount = remainingAmount
            } else {
              discountAmount = requestedDiscountAmount
            }
          } else {
            // No seasonal cap - use full discount
            discountAmount = requestedDiscountAmount
          }
        }

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

      // Build alternates map from ALL registered alternates, not just those who have played
      const alternatesMap = new Map<string, {
        user_id: string
        first_name: string
        last_name: string
        email: string
        is_lgbtq: boolean | null
        is_goalie: boolean
        times_played: number
        total_paid: number
        selections: Array<{
          game_description: string
          game_date: string
          amount_charged: number
          selected_at: string
        }>
      }>()

      // First, add ALL registered alternates to the map (even if they haven't played)
      userAlternateRegistrations?.forEach(altReg => {
        const user = Array.isArray(altReg.users) ? altReg.users[0] : altReg.users
        if (!user) return

        const userId = user.id
        if (!alternatesMap.has(userId)) {
          alternatesMap.set(userId, {
            user_id: userId,
            first_name: user.first_name || '',
            last_name: user.last_name || '',
            email: user.email || 'Unknown',
            is_lgbtq: user.is_lgbtq,
            is_goalie: user.is_goalie || false,
            times_played: 0,
            total_paid: 0,
            selections: []
          })
        }
      })

      // Then, add selection details for those who have played
      alternateSelectionsData?.forEach(selection => {
        const user = Array.isArray(selection.users) ? selection.users[0] : selection.users
        const alternateReg = Array.isArray(selection.alternate_registrations) ? selection.alternate_registrations[0] : selection.alternate_registrations

        if (!user) return

        const userId = user.id
        // Get or create the user entry (should already exist from above, but defensive)
        if (!alternatesMap.has(userId)) {
          alternatesMap.set(userId, {
            user_id: userId,
            first_name: '',
            last_name: '',
            email: 'Unknown',
            is_lgbtq: null,
            is_goalie: false,
            times_played: 0,
            total_paid: 0,
            selections: []
          })
        }

        const userData = alternatesMap.get(userId)!
        userData.times_played += 1
        userData.total_paid += selection.amount_charged || 0
        userData.selections.push({
          game_description: alternateReg?.game_description || 'Unknown Game',
          game_date: alternateReg?.game_date || '',
          amount_charged: selection.amount_charged || 0,
          selected_at: selection.selected_at
        })
      })

      // Convert map to array
      const processedAlternatesData = Array.from(alternatesMap.values())

      return NextResponse.json({
        data: processedData,
        waitlistData: processedWaitlistData,
        alternatesData: processedAlternatesData
      })
    } else {
      // Get all registrations for selection with category counts
      const { data: registrationsList, error: registrationsError } = await adminSupabase
        .from('registrations')
        .select(`
          id,
          name,
          type,
          start_date,
          end_date,
          allow_alternates,
          seasons (
            id,
            name,
            start_date,
            end_date
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
        .order('created_at', { ascending: false })

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

      // Get alternates counts for each registration (all registered alternates, not just those who played)
      const { data: alternatesCounts, error: alternatesError} = await adminSupabase
        .from('user_alternate_registrations')
        .select('user_id, registration_id')
        .in('registration_id', registrationIds)

      if (alternatesError) {
        logger.logSystem('registration-reports-api', 'Error fetching alternates counts', { error: alternatesError }, 'error')
      }

      // Get captains for each registration
      const { data: captainsData, error: captainsError } = await adminSupabase
        .from('registration_captains')
        .select(`
          registration_id,
          users!registration_captains_user_id_fkey!inner (
            first_name,
            last_name
          )
        `)
        .in('registration_id', registrationIds)

      if (captainsError) {
        logger.logSystem('registration-reports-api', 'Error fetching captains', { error: captainsError }, 'error')
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

      // Create a map of unique alternates count by registration_id
      const alternatesCountMap = new Map<string, Set<string>>()
      alternatesCounts?.forEach(altReg => {
        const regId = altReg.registration_id

        if (regId) {
          if (!alternatesCountMap.has(regId)) {
            alternatesCountMap.set(regId, new Set())
          }

          // Add user_id to the set (automatically handles uniqueness)
          alternatesCountMap.get(regId)!.add(altReg.user_id)
        }
      })

      // Create a map of captains by registration_id
      const captainsMap = new Map<string, Array<{ first_name: string; last_name: string }>>()
      captainsData?.forEach(captain => {
        const regId = captain.registration_id
        const user = Array.isArray(captain.users) ? captain.users[0] : captain.users

        if (regId && user) {
          if (!captainsMap.has(regId)) {
            captainsMap.set(regId, [])
          }

          captainsMap.get(regId)!.push({
            first_name: user.first_name || '',
            last_name: user.last_name || ''
          })
        }
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

        // Get alternates count (unique users who have selected alternates for this registration)
        const alternatesCount = alternatesCountMap.get(item.id)?.size || 0

        // Get captains for this registration
        const captains = captainsMap.get(item.id) || []

        return {
          id: item.id,
          name: item.name,
          type: item.type,
          start_date: item.start_date,
          end_date: item.end_date,
          season_id: season?.id || null,
          season_name: season?.name || 'Unknown Season',
          season_start_date: season?.start_date || null,
          season_end_date: season?.end_date || null,
          total_count: totalCount,
          total_capacity: totalCapacity > 0 ? totalCapacity : null,
          total_waitlist_count: totalWaitlistCount,
          alternates_count: alternatesCount,
          alternates_enabled: item.allow_alternates || false,
          category_breakdown: categoryBreakdown,
          captains: captains
        }
      }) || []

      return NextResponse.json({ data: processedRegistrations })
    }
  } catch (error) {
    logger.logSystem('registration-reports-api', 'Error in registration reports API', { error }, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}