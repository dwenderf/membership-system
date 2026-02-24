import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'
import { canAccessRegistrationAlternates } from '@/lib/utils/alternates-access'
import { userHasValidPaymentMethod } from '@/lib/payment-method-utils'

// GET /api/alternate-registrations/[gameId]/alternates - Get available alternates for a game
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { gameId } = await params

    // Get game details to verify it exists and get registration info
    const { data: game, error: gameError } = await supabase
      .from('alternate_registrations')
      .select(`
        id,
        registration_id,
        game_description,
        game_date,
        registrations (
          id,
          name,
          alternate_price,
          alternate_accounting_code,
          allow_alternates,
          season_id
        )
      `)
      .eq('id', gameId)
      .single()

    if (gameError || !game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 })
    }

    // Validate critical fields exist before using them
    if (!game.registration_id) {
      return NextResponse.json({ error: 'Invalid game data: missing registration_id' }, { status: 500 })
    }

    if (!game.registrations) {
      return NextResponse.json({ error: 'Invalid game data: missing registration details' }, { status: 500 })
    }

    // Check if user has access to this registration's alternates (admin or captain)
    const hasAccess = await canAccessRegistrationAlternates(game.registration_id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'You do not have access to manage alternates for this registration' }, { status: 403 })
    }

    const registration = Array.isArray(game.registrations) ? game.registrations[0] : game.registrations
    if (!registration || !registration.allow_alternates) {
      return NextResponse.json({
        error: 'This registration does not allow alternates'
      }, { status: 400 })
    }

    // Access verified - use admin client to bypass RLS for data queries
    const adminSupabase = createAdminClient()

    // Get all users who registered as alternates for this registration
    const { data: alternates, error: alternatesError } = await adminSupabase
      .from('user_alternate_registrations')
      .select(`
        id,
        user_id,
        discount_code_id,
        created_at,
        users (
          id,
          first_name,
          last_name,
          email,
          stripe_payment_method_id,
          setup_intent_status
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
      .eq('registration_id', game.registration_id)

    if (alternatesError) {
      logger.logSystem('get-alternates-error', 'Failed to fetch alternates', {
        gameId,
        registrationId: game.registration_id,
        error: alternatesError.message
      })
      
      return NextResponse.json({ 
        error: 'Failed to fetch alternates' 
      }, { status: 500 })
    }

    // Check which alternates are already selected for this specific game
    const { data: existingSelections, error: selectionsError } = await adminSupabase
      .from('alternate_selections')
      .select('user_id')
      .eq('alternate_registration_id', gameId)

    if (selectionsError) {
      logger.logSystem('get-selections-error', 'Failed to fetch existing selections', {
        gameId,
        error: selectionsError.message
      })
    }

    const selectedUserIds = new Set(existingSelections?.map(s => s.user_id) || [])

    // Get discount usage for each user to check limits
    // IMPORTANT: Filter by season_id to only count usage for THIS season
    const userIds = alternates?.map(alt => alt.user_id) || []
    const registrationSeasonId = registration?.season_id

    let discountUsageQuery = adminSupabase
      .from('discount_usage_computed')
      .select('user_id, discount_category_id, amount_saved')
      .in('user_id', userIds)

    // Filter by the registration's season to get correct seasonal usage
    if (registrationSeasonId) {
      discountUsageQuery = discountUsageQuery.eq('season_id', registrationSeasonId)
    }

    const { data: discountUsage } = await discountUsageQuery

    // Group usage by user and category
    const usageByUserAndCategory = new Map()
    discountUsage?.forEach(usage => {
      const key = `${usage.user_id}-${usage.discount_category_id}`
      const current = usageByUserAndCategory.get(key) || 0
      usageByUserAndCategory.set(key, current + usage.amount_saved)
    })

    // Format alternates data with payment status and discount info
    const formattedAlternates = (alternates || []).map(alternate => {
      const user = Array.isArray(alternate.users) ? alternate.users[0] : alternate.users
      const discountCode = Array.isArray(alternate.discount_codes) ? alternate.discount_codes[0] : alternate.discount_codes
      
      // Check if user has valid payment method
      const hasValidPaymentMethod = userHasValidPaymentMethod(user)
      
      // Calculate discount amount and check usage limits
      let discountAmount = 0
      let isOverLimit = false
      let usageStatus = null
      let category = null

      if (discountCode && registration) {
        const basePrice = registration.alternate_price || 0

        // Calculate discount amount (discount codes are always percentage-based)
        let requestedDiscountAmount = Math.round((basePrice * discountCode.percentage) / 100)

        // Check usage limits and apply seasonal cap
        category = Array.isArray(discountCode.category) ? discountCode.category[0] : discountCode.category
        if (category && category.max_discount_per_user_per_season) {
          const usageKey = `${user?.id}-${category.id}`
          const currentUsage = usageByUserAndCategory.get(usageKey) || 0
          const limit = category.max_discount_per_user_per_season
          const remainingAmount = Math.max(0, limit - currentUsage)

          isOverLimit = (currentUsage + requestedDiscountAmount) > limit

          // Apply seasonal cap - use remaining amount if would exceed
          if (isOverLimit) {
            discountAmount = remainingAmount
          } else {
            discountAmount = requestedDiscountAmount
          }

          usageStatus = {
            currentUsage,
            limit,
            wouldExceed: isOverLimit,
            remainingAmount,
            requestedAmount: requestedDiscountAmount,
            appliedAmount: discountAmount
          }
        } else {
          // No seasonal cap - use full discount
          discountAmount = requestedDiscountAmount
        }
      }

      const finalAmount = Math.max(0, (registration?.alternate_price || 0) - discountAmount)

      return {
        id: alternate.id,
        userId: user?.id,
        firstName: user?.first_name,
        lastName: user?.last_name,
        email: user?.email,
        registeredAt: alternate.created_at,
        hasValidPaymentMethod,
        isAlreadySelected: selectedUserIds.has(user?.id),
        discountCode: discountCode ? {
          id: discountCode.id,
          code: discountCode.code,
          percentage: discountCode.percentage,
          discountAmount,
          categoryName: category?.name,
          isOverLimit,
          usageStatus
        } : null,
        pricing: {
          basePrice: registration?.alternate_price || 0,
          discountAmount,
          finalAmount
        }
      }
    })

    // Sort alternates: available first, then by registration date
    formattedAlternates.sort((a, b) => {
      // Available alternates first
      if (a.isAlreadySelected !== b.isAlreadySelected) {
        return a.isAlreadySelected ? 1 : -1
      }
      
      // Then by registration date (earliest first)  
      return new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime()
    })

    return NextResponse.json({
      game: {
        id: game.id,
        registrationId: game.registration_id,
        registrationName: registration?.name,
        gameDescription: game.game_description,
        gameDate: game.game_date,
        alternatePrice: registration?.alternate_price,
        alternateAccountingCode: registration?.alternate_accounting_code
      },
      alternates: formattedAlternates,
      summary: {
        totalAlternates: formattedAlternates.length,
        availableAlternates: formattedAlternates.filter(a => !a.isAlreadySelected).length,
        alreadySelected: formattedAlternates.filter(a => a.isAlreadySelected).length,
        withValidPayment: formattedAlternates.filter(a => a.hasValidPaymentMethod).length,
        withDiscounts: formattedAlternates.filter(a => a.discountCode).length,
        overLimitDiscounts: formattedAlternates.filter(a => a.discountCode?.isOverLimit).length
      }
    })

  } catch (error) {
    logger.logSystem('get-game-alternates-error', 'Unexpected error fetching game alternates', {
      gameId: 'unknown',
      error: error instanceof Error ? error.message : String(error)
    })
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}