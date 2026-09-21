import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'
import { canAccessRegistrationAlternates } from '@/lib/utils/alternates-access'

// PATCH /api/alternate-registrations/[gameId]/schedule - Update game date/time
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
    const { gameDate, gameEndTime } = body

    if (!gameDate) {
      return NextResponse.json({ error: 'Game date and time is required' }, { status: 400 })
    }

    const parsedStart = new Date(gameDate)
    if (isNaN(parsedStart.getTime())) {
      return NextResponse.json({ error: 'Invalid game date' }, { status: 400 })
    }

    if (gameEndTime) {
      const parsedEnd = new Date(gameEndTime)
      if (isNaN(parsedEnd.getTime())) {
        return NextResponse.json({ error: 'Invalid game end time' }, { status: 400 })
      }
      if (parsedEnd <= parsedStart) {
        return NextResponse.json({ error: 'Game end time must be after the start time' }, { status: 400 })
      }
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

    // Update the game date/time
    const { error: updateError } = await supabase
      .from('alternate_registrations')
      .update({
        game_date: parsedStart.toISOString(),
        game_end_time: gameEndTime ? new Date(gameEndTime).toISOString() : null
      })
      .eq('id', gameId)

    if (updateError) {
      logger.logSystem('update-game-schedule-failed', 'Failed to update game schedule', {
        gameId,
        error: updateError.message
      })

      return NextResponse.json({ error: 'Failed to update game date and time' }, { status: 500 })
    }

    logger.logSystem('game-schedule-updated', 'Game date/time updated', {
      gameId,
      updatedBy: authUser.id
    })

    return NextResponse.json({
      success: true,
      gameDate: parsedStart.toISOString(),
      gameEndTime: gameEndTime ? new Date(gameEndTime).toISOString() : null
    })

  } catch (error) {
    logger.logSystem('update-game-schedule-error', 'Unexpected error updating game schedule', {
      error: error instanceof Error ? error.message : String(error)
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
