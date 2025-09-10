import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'

// GET /api/alternate-registrations/[gameId]/alternates - Get available alternates for a game
export async function GET(
  request: NextRequest,
  { params }: { params: { gameId: string } }
) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const gameId = params.gameId

    // Check if user is admin (for now, we'll add captain check later)
    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!userProfile?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

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
          allow_alternates
        )
      `)
      .eq('id', gameId)
      .single()

    if (gameError || !game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 })
    }

    if (!game.registrations?.allow_alternates) {
      return NextResponse.json({ 
        error: 'This registration does not allow alternates' 
      }, { status: 400 })
    }

    // Get all users who registered as alternates for this registration
    const { data: alternates, error: alternatesError } = await supabase
      .from('user_alternate_registrations')
      .select(`
        id,
        user_id,
        discount_code_id,
        registered_at,
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
          discount_type,
          discount_value,
          category:discount_categories (
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
    const { data: existingSelections, error: selectionsError } = await supabase
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
    const userIds = alternates?.map(alt => alt.user_id) || []
    const { data: discountUsage } = await supabase
      .from('discount_usage')
      .select('user_id, discount_category_id, amount_saved')
      .in('user_id', userIds)

    // Group usage by user and category
    const usageByUserAndCategory = new Map()
    discountUsage?.forEach(usage => {
      const key = `${usage.user_id}-${usage.discount_category_id}`
      const current = usageByUserAndCategory.get(key) || 0
      usageByUserAndCategory.set(key, current + usage.amount_saved)
    })

    // Format alternates data with payment status and discount info
    const formattedAlternates = (alternates || []).map(alternate => {
      const user = alternate.users
      const discountCode = alternate.discount_codes
      
      // Check if user has valid payment method
      const hasValidPaymentMethod = user?.stripe_payment_method_id && user?.setup_intent_status === 'succeeded'
      
      // Calculate discount amount and check usage limits
      let discountAmount = 0
      let isOverLimit = false
      let usageStatus = null

      if (discountCode && game.registrations) {
        const basePrice = game.registrations.alternate_price || 0
        
        // Calculate discount amount
        if (discountCode.discount_type === 'percentage') {
          discountAmount = Math.round((basePrice * discountCode.discount_value) / 100)
        } else {
          discountAmount = Math.min(discountCode.discount_value, basePrice)
        }

        // Check usage limits
        if (discountCode.category?.max_discount_per_user_per_season) {
          const usageKey = `${user?.id}-${discountCode.category.id}`
          const currentUsage = usageByUserAndCategory.get(usageKey) || 0
          const limit = discountCode.category.max_discount_per_user_per_season
          
          isOverLimit = (currentUsage + discountAmount) > limit
          usageStatus = {
            currentUsage,
            limit,
            wouldExceed: isOverLimit,
            remainingAmount: Math.max(0, limit - currentUsage)
          }
        }
      }

      const finalAmount = Math.max(0, (game.registrations?.alternate_price || 0) - discountAmount)

      return {
        id: alternate.id,
        userId: user?.id,
        firstName: user?.first_name,
        lastName: user?.last_name,
        email: user?.email,
        registeredAt: alternate.registered_at,
        hasValidPaymentMethod,
        isAlreadySelected: selectedUserIds.has(user?.id),
        discountCode: discountCode ? {
          id: discountCode.id,
          code: discountCode.code,
          discountType: discountCode.discount_type,
          discountValue: discountCode.discount_value,
          discountAmount,
          categoryName: discountCode.category?.name,
          isOverLimit,
          usageStatus
        } : null,
        pricing: {
          basePrice: game.registrations?.alternate_price || 0,
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
        registrationName: game.registrations?.name,
        gameDescription: game.game_description,
        gameDate: game.game_date,
        alternatePrice: game.registrations?.alternate_price,
        alternateAccountingCode: game.registrations?.alternate_accounting_code
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
      gameId: params.gameId,
      error: error instanceof Error ? error.message : String(error)
    })
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}