import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { AlternatePaymentService } from '@/lib/services/alternate-payment-service'
import { logger } from '@/lib/logging/logger'
import { canAccessRegistrationAlternates } from '@/lib/utils/alternates-access'

// POST /api/alternate-registrations/[gameId]/select - Select alternates for a game
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    // Check authentication
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { gameId } = await params
    const body = await request.json()
    const { alternateIds } = body

    if (!alternateIds || !Array.isArray(alternateIds) || alternateIds.length === 0) {
      return NextResponse.json({ error: 'Alternate IDs are required' }, { status: 400 })
    }

    // Get game details
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
          allow_alternates,
          alternate_price,
          alternate_accounting_code
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
    // Get alternate registration details
    const { data: alternateRegistrations, error: alternatesError } = await adminSupabase
      .from('user_alternate_registrations')
      .select(`
        id,
        user_id,
        discount_code_id,
        users (
          id,
          first_name,
          last_name,
          email,
          stripe_payment_method_id,
          setup_intent_status
        )
      `)
      .in('id', alternateIds)
      .eq('registration_id', game.registration_id)

    if (alternatesError || !alternateRegistrations) {
      return NextResponse.json({ error: 'Failed to fetch alternate registrations' }, { status: 500 })
    }

    if (alternateRegistrations.length !== alternateIds.length) {
      return NextResponse.json({ error: 'Some alternate registrations not found' }, { status: 404 })
    }

    // Check for existing selections to prevent duplicates
    const { data: existingSelections } = await adminSupabase
      .from('alternate_selections')
      .select('user_id')
      .eq('alternate_registration_id', gameId)
      .in('user_id', alternateRegistrations.map(ar => ar.user_id))

    const alreadySelectedUserIds = new Set(existingSelections?.map(s => s.user_id) || [])
    
    // Filter out already selected users
    const availableAlternates = alternateRegistrations.filter(ar => 
      !alreadySelectedUserIds.has(ar.user_id)
    )

    if (availableAlternates.length === 0) {
      return NextResponse.json({ 
        error: 'All selected alternates are already selected for this game' 
      }, { status: 400 })
    }

    // Process each alternate selection
    const results = []
    let totalAmountCharged = 0
    let successfulSelections = 0
    let failedSelections = 0

    for (const alternate of availableAlternates) {
      const user = Array.isArray(alternate.users) ? alternate.users[0] : alternate.users
      try {
        // Validate payment method (presence of stripe_payment_method_id is sufficient)
        if (!user?.stripe_payment_method_id) {
          results.push({
            userId: alternate.user_id,
            userName: `${user?.first_name} ${user?.last_name}`,
            success: false,
            error: 'No valid payment method'
          })
          failedSelections++
          continue
        }

        // Process payment
        const chargeResult = await AlternatePaymentService.chargeAlternate(
          alternate.user_id,
          game.registration_id,
          game.game_description,
          gameId,
          alternate.discount_code_id || undefined
        )

        if (chargeResult.success) {
          // Create selection record
          const { error: selectionError } = await adminSupabase
            .from('alternate_selections')
            .insert({
              alternate_registration_id: gameId,
              user_id: alternate.user_id,
              payment_id: chargeResult.paymentId,
              amount_charged: chargeResult.amountCharged,
              selected_by: authUser.id,
              selected_at: new Date().toISOString()
            })

          if (selectionError) {
            logger.logSystem('selection-record-failed', 'Failed to create selection record', {
              gameId,
              userId: alternate.user_id,
              paymentId: chargeResult.paymentId,
              error: selectionError.message
            })
            
            results.push({
              userId: alternate.user_id,
              userName: `${user?.first_name} ${user?.last_name}`,
              success: false,
              error: 'Payment succeeded but failed to record selection'
            })
            failedSelections++
          } else {
            results.push({
              userId: alternate.user_id,
              userName: `${user?.first_name} ${user?.last_name}`,
              success: true,
              paymentId: chargeResult.paymentId,
              amountCharged: chargeResult.amountCharged
            })
            totalAmountCharged += chargeResult.amountCharged
            successfulSelections++
          }
        } else {
          results.push({
            userId: alternate.user_id,
            userName: `${user?.first_name} ${user?.last_name}`,
            success: false,
            error: 'Payment failed'
          })
          failedSelections++
        }

      } catch (error) {
        logger.logSystem('alternate-selection-error', 'Error processing alternate selection', {
          gameId,
          userId: alternate.user_id,
          error: error instanceof Error ? error.message : String(error)
        })

        results.push({
          userId: alternate.user_id,
          userName: `${user?.first_name} ${user?.last_name}`,
          success: false,
          error: error instanceof Error ? error.message : 'Processing failed'
        })
        failedSelections++
      }
    }

    logger.logSystem('alternate-selections-completed', 'Alternate selection process completed', {
      gameId,
      registrationId: game.registration_id,
      gameDescription: game.game_description,
      totalProcessed: availableAlternates.length,
      successfulSelections,
      failedSelections,
      totalAmountCharged,
      selectedBy: authUser.id
    })

    return NextResponse.json({
      success: true,
      message: `Processed ${availableAlternates.length} alternate selections`,
      summary: {
        totalProcessed: availableAlternates.length,
        totalSelected: alternateIds.length,
        successfulSelections,
        failedSelections,
        totalAmountCharged,
        alreadySelected: alternateRegistrations.length - availableAlternates.length
      },
      results,
      game: {
        id: game.id,
        description: game.game_description,
        registrationName: registration?.name
      }
    })

  } catch (error) {
    logger.logSystem('alternate-selection-error', 'Unexpected error in alternate selection', {
      gameId: 'unknown',
      error: error instanceof Error ? error.message : String(error)
    })
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}