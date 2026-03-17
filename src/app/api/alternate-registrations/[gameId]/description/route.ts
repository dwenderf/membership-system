import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'
import { canAccessRegistrationAlternates } from '@/lib/utils/alternates-access'

// PATCH /api/alternate-registrations/[gameId]/description - Update game description
export async function PATCH(
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

    const body = await request.json()
    const { gameDescription } = body

    if (!gameDescription || gameDescription.trim().length === 0) {
      return NextResponse.json({ error: 'Game description cannot be empty' }, { status: 400 })
    }

    // Fetch game to get registration_id for access check
    const { data: game, error: gameError } = await supabase
      .from('alternate_registrations')
      .select('id, registration_id')
      .eq('id', gameId)
      .single()

    if (gameError || !game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 })
    }

    // Check if user has access (admin or captain)
    const hasAccess = await canAccessRegistrationAlternates(game.registration_id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'You do not have access to manage alternates for this registration' }, { status: 403 })
    }

    // Update the game description
    const { error: updateError } = await supabase
      .from('alternate_registrations')
      .update({ game_description: gameDescription.trim() })
      .eq('id', gameId)

    if (updateError) {
      logger.logSystem('update-game-description-failed', 'Failed to update game description', {
        gameId,
        error: updateError.message
      })

      return NextResponse.json({ error: 'Failed to update game description' }, { status: 500 })
    }

    logger.logSystem('game-description-updated', 'Game description updated', {
      gameId,
      updatedBy: authUser.id
    })

    return NextResponse.json({ success: true, gameDescription: gameDescription.trim() })

  } catch (error) {
    logger.logSystem('update-game-description-error', 'Unexpected error updating game description', {
      error: error instanceof Error ? error.message : String(error)
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
