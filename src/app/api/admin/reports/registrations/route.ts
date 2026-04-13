import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { userHasValidPaymentMethod } from '@/lib/payment-method-utils'

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

      // Get the registration's season_id first (needed for discount usage filtering)
      const { data: registrationInfo } = await adminSupabase
        .from('registrations')
        .select('season_id')
        .eq('id', registrationId)
        .single()

      const registrationSeasonId = registrationInfo?.season_id

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
      // IMPORTANT: Filter by season_id to only count usage for THIS season
      const waitlistUserIds = waitlistData?.map(w => {
        const user = Array.isArray(w.users) ? w.users[0] : w.users
        return user?.id
      }).filter(Boolean) || []

      let discountUsageQuery = adminSupabase
        .from('discount_usage_computed')
        .select('user_id, discount_category_id, amount_saved')
        .in('user_id', waitlistUserIds)

      // Filter by the registration's season to get correct seasonal usage
      if (registrationSeasonId) {
        discountUsageQuery = discountUsageQuery.eq('season_id', registrationSeasonId)
      }

      const { data: discountUsageData } = await discountUsageQuery

      // Group usage by user and category
      const usageByUserAndCategory = new Map()
      discountUsageData?.forEach(usage => {
        const key = `${usage.user_id}-${usage.discount_category_id}`
        const current = usageByUserAndCategory.get(key) || 0
        usageByUserAndCategory.set(key, current + usage.amount_saved)
      })

      // Fetch discount usage for main roster members to populate the discount column.
      // Filter by registration_id and exclude credit note reversals (invoice_type = 'ACCREC' only).
      const { data: rosterDiscountData } = await adminSupabase
        .from('discount_usage_computed')
        .select('user_id, discount_code, amount_saved, invoice_type')
        .eq('registration_id', registrationId)
        .eq('invoice_type', 'ACCREC')

      // Build map: user_id → { discount_code, amount_saved } (take first/largest discount per user)
      const rosterDiscountMap = new Map<string, { discount_code: string; amount_saved: number }>()
      rosterDiscountData?.forEach(usage => {
        const existing = rosterDiscountMap.get(usage.user_id)
        if (!existing || usage.amount_saved > existing.amount_saved) {
          rosterDiscountMap.set(usage.user_id, {
            discount_code: usage.discount_code || '',
            amount_saved: usage.amount_saved || 0
          })
        }
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
        const userId = user?.id || ''
        const discountInfo = rosterDiscountMap.get(userId)

        return {
          id: item.id,
          registration_id: item.registration_id,
          registration_name: registration?.name || 'Unknown Registration',
          season_name: season?.name || 'Unknown Season',
          registration_type: registration?.type || 'Unknown',
          user_id: userId || 'Unknown',
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
          invoice_number: xeroInvoice?.invoice_number || null,
          discount_code: discountInfo?.discount_code || null,
          discount_amount_saved: discountInfo?.amount_saved || 0
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
        const hasValidPaymentMethod = userHasValidPaymentMethod(user)

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
        registered_at: string
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
            registered_at: altReg.created_at || '',
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
            registered_at: '',
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

      // Compute financial summary for the detail page
      const paidRoster = processedData.filter(m => m.payment_status === 'paid')
      const rosterGross = paidRoster.reduce((sum, m) => sum + m.registration_fee, 0)
      const rosterNet = paidRoster.reduce((sum, m) => sum + m.amount_paid, 0)
      const altNet = processedAlternatesData.reduce((sum, a) => sum + a.total_paid, 0)
      const financialSummary = {
        roster_gross: rosterGross,
        roster_discounts: rosterGross - rosterNet,
        roster_net: rosterNet,
        alt_gross: altNet, // gross not available without additional payment join; use net
        alt_discounts: 0,
        alt_net: altNet,
        total_net: rosterNet + altNet
      }

      return NextResponse.json({
        data: processedData,
        waitlistData: processedWaitlistData,
        alternatesData: processedAlternatesData,
        financialSummary
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
      // Join registration_categories so we can group by category name, not UUID.
      // This ensures counts are correct even if category records were ever recreated
      // (same name, new UUID) — which would cause UUID-based lookups to silently miss members.
      const registrationIds = registrationsList?.map(r => r.id) || []

      // Fetch all user_registrations for counting and financials.
      // No payment_status filter here so the count matches what the detail page shows.
      // We apply a payment_status filter only when computing financial totals (see below).
      // The .limit(50000) prevents Supabase's default 1000-row cap from silently truncating
      // results when the total number of registrations across active registrations is large.
      const { data: registrationCounts, error: countsError } = await adminSupabase
        .from('user_registrations')
        .select(`
          registration_id,
          registration_category_id,
          payment_status,
          amount_paid,
          registration_fee,
          registration_categories (
            custom_name,
            categories (
              name
            )
          )
        `)
        .in('registration_id', registrationIds)
        .limit(50000)

      if (countsError) {
        logger.logSystem('registration-reports-api', 'Error fetching registration counts', { error: countsError }, 'error')
      }

      // Get waitlist counts for each registration
      const { data: waitlistCounts, error: waitlistError } = await adminSupabase
        .from('waitlists')
        .select(`
          registration_id,
          registration_category_id,
          registration_categories (
            custom_name,
            categories (
              name
            )
          )
        `)
        .in('registration_id', registrationIds)
        .is('removed_at', null)
        .limit(50000)

      if (waitlistError) {
        logger.logSystem('registration-reports-api', 'Error fetching waitlist counts', { error: waitlistError }, 'error')
      }

      // Get alternates counts for each registration (all registered alternates, not just those who played)
      const { data: alternatesCounts, error: alternatesError} = await adminSupabase
        .from('user_alternate_registrations')
        .select('user_id, registration_id')
        .in('registration_id', registrationIds)
        .limit(50000)

      if (alternatesError) {
        logger.logSystem('registration-reports-api', 'Error fetching alternates counts', { error: alternatesError }, 'error')
      }

      // Get alternate selection financial data (revenue charged per game appearance).
      // Join to payments for status and gross amount; discount = total_amount - final_amount.
      const { data: alternateSelectionsFinancial, error: altFinancialError } = await adminSupabase
        .from('alternate_selections')
        .select(`
          amount_charged,
          discount_code_id,
          alternate_registrations!inner (
            registration_id
          ),
          payments (
            total_amount,
            final_amount,
            status
          )
        `)
        .in('alternate_registrations.registration_id', registrationIds)

      if (altFinancialError) {
        logger.logSystem('registration-reports-api', 'Error fetching alternate selections financial data', { error: altFinancialError }, 'error')
      }

      // Build alternate financial map keyed by registration_id.
      // Only include paid/processing alternates; gross = payments.total_amount, net = amount_charged.
      const altFinancialMap = new Map<string, { alt_gross: number; alt_net: number }>()
      alternateSelectionsFinancial?.forEach(sel => {
        const altReg = Array.isArray(sel.alternate_registrations) ? sel.alternate_registrations[0] : sel.alternate_registrations
        const payment = Array.isArray(sel.payments) ? sel.payments[0] : sel.payments
        const regId = altReg?.registration_id
        if (!regId) return
        // Only count if payment exists and is paid/processing
        if (payment && !['completed', 'pending', 'processing'].includes(payment.status)) return
        const fin = altFinancialMap.get(regId) || { alt_gross: 0, alt_net: 0 }
        fin.alt_gross += payment?.total_amount || sel.amount_charged
        fin.alt_net += payment?.final_amount || sel.amount_charged
        altFinancialMap.set(regId, fin)
      })

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

      // Helper to resolve a category name from a joined registration_categories record
      const resolveCatName = (regCat: { custom_name?: string | null; categories?: { name?: string } | { name?: string }[] | null } | null | undefined): string => {
        if (!regCat) return 'Unknown Category'
        const cat = Array.isArray(regCat.categories) ? regCat.categories[0] : regCat.categories
        return cat?.name || regCat.custom_name || 'Unknown Category'
      }

      // Build counts map keyed by registration_id → category_name → count.
      // Using category name (not UUID) so counts accumulate correctly even when category
      // UUIDs differ between what users registered under and the current categories list.
      const countsMap = new Map<string, Map<string, number>>()
      // Also track financial totals per registration for the financial summary
      const financialMap = new Map<string, { roster_gross: number; roster_net: number }>()

      registrationCounts?.forEach(count => {
        const regId = count.registration_id
        const regCat = Array.isArray(count.registration_categories) ? count.registration_categories[0] : count.registration_categories
        const catName = resolveCatName(regCat)

        if (!countsMap.has(regId)) {
          countsMap.set(regId, new Map())
        }
        const regMap = countsMap.get(regId)!
        regMap.set(catName, (regMap.get(catName) || 0) + 1)

        // Accumulate financial totals for paid members only — matches detail page paidRoster logic
        if (count.payment_status === 'paid') {
          const fin = financialMap.get(regId) || { roster_gross: 0, roster_net: 0 }
          fin.roster_gross += count.registration_fee || 0
          fin.roster_net += count.amount_paid || 0
          financialMap.set(regId, fin)
        }
      })

      // Create a map of waitlist counts by registration_id and category_name
      const waitlistMap = new Map<string, Map<string, number>>()
      waitlistCounts?.forEach(count => {
        const regId = count.registration_id
        const regCat = Array.isArray(count.registration_categories) ? count.registration_categories[0] : count.registration_categories
        const catName = resolveCatName(regCat)

        if (!waitlistMap.has(regId)) {
          waitlistMap.set(regId, new Map())
        }
        const regMap = waitlistMap.get(regId)!
        regMap.set(catName, (regMap.get(catName) || 0) + 1)
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
        
        // Calculate category breakdown with counts and waitlist counts.
        // Look up by category name so counts are correct even if category UUIDs changed.
        const registrationCountsForReg = countsMap.get(item.id)
        const waitlistCountsForReg = waitlistMap.get(item.id)

        const categoryBreakdown = categories.map(cat => {
          const category = Array.isArray(cat.categories) ? cat.categories[0] : cat.categories
          const catName = category?.name || cat.custom_name || 'Unknown Category'
          const count = registrationCountsForReg?.get(catName) || 0
          const waitlistCount = waitlistCountsForReg?.get(catName) || 0

          return {
            id: cat.id,
            name: catName,
            count: count,
            waitlist_count: waitlistCount,
            max_capacity: cat.max_capacity,
            percentage_full: cat.max_capacity ? Math.round((count / cat.max_capacity) * 100) : null
          }
        })

        // Total count = sum of ALL active members from the counts map (includes any whose
        // category UUID doesn't match a current category, e.g. legacy registrations)
        const totalCount = Array.from(registrationCountsForReg?.values() || []).reduce((sum, c) => sum + c, 0)
        const totalCapacity = categoryBreakdown.reduce((sum, cat) => sum + (cat.max_capacity || 0), 0)
        const totalWaitlistCount = Array.from(waitlistCountsForReg?.values() || []).reduce((sum, c) => sum + c, 0)

        // Get alternates count (unique users who have selected alternates for this registration)
        const alternatesCount = alternatesCountMap.get(item.id)?.size || 0

        // Get captains for this registration
        const captains = captainsMap.get(item.id) || []

        // Build financial summary
        const rosterFin = financialMap.get(item.id) || { roster_gross: 0, roster_net: 0 }
        const altFin = altFinancialMap.get(item.id) || { alt_gross: 0, alt_net: 0 }
        const financialSummary = {
          roster_gross: rosterFin.roster_gross,
          roster_discounts: rosterFin.roster_gross - rosterFin.roster_net,
          roster_net: rosterFin.roster_net,
          alt_gross: altFin.alt_gross,
          alt_discounts: altFin.alt_gross - altFin.alt_net,
          alt_net: altFin.alt_net,
          total_net: rosterFin.roster_net + altFin.alt_net
        }

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
          captains: captains,
          financial_summary: financialSummary
        }
      }) || []

      return NextResponse.json({ data: processedRegistrations })
    }
  } catch (error) {
    logger.logSystem('registration-reports-api', 'Error in registration reports API', { error }, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}