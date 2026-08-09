import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'
import { checkAlternatesAccess } from '@/lib/utils/alternates-access'

interface FormattedGame {
  id: string
  registrationId: string
  gameDescription: string
  gameDate: string | null
  gameEndTime: string | null
  createdAt: string
  alternateSelections: number
  selectedCount: number
  availableCount: number
}

// GET /api/alternate-registrations/batch - Get games for multiple registrations in one request
// Avoids N+1 fetches when rendering an overview across many registrations at once.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const registrationIdsParam = searchParams.get('registrationIds')

    if (!registrationIdsParam) {
      return NextResponse.json({ error: 'registrationIds is required' }, { status: 400 })
    }

    const requestedIds = Array.from(new Set(
      registrationIdsParam.split(',').map(id => id.trim()).filter(Boolean)
    ))

    if (requestedIds.length === 0) {
      return NextResponse.json({ error: 'registrationIds is required' }, { status: 400 })
    }

    // Check access (admin or captain) and scope the request to registrations the user can see
    const access = await checkAlternatesAccess()
    if (!access.hasAccess) {
      return NextResponse.json({ error: 'You do not have access to manage alternates' }, { status: 403 })
    }

    const registrationIds = access.isAdmin
      ? requestedIds
      : requestedIds.filter(id => access.accessibleRegistrations?.includes(id))

    const gamesByRegistration: Record<string, FormattedGame[]> = {}
    for (const id of registrationIds) {
      gamesByRegistration[id] = []
    }

    if (registrationIds.length === 0) {
      return NextResponse.json({ games: gamesByRegistration })
    }

    // Get games for all requested registrations in a single query
    const { data: games, error: gamesError } = await supabase
      .from('alternate_registrations')
      .select(`
        id,
        registration_id,
        game_description,
        game_date,
        game_end_time,
        created_at,
        created_by,
        alternate_selections (
          id
        )
      `)
      .in('registration_id', registrationIds)
      .order('game_date', { ascending: false })

    if (gamesError) {
      logger.logSystem('get-games-batch-error', 'Failed to fetch games for batch', {
        registrationIds,
        error: gamesError.message
      })

      return NextResponse.json({
        error: 'Failed to fetch games'
      }, { status: 500 })
    }

    // Get total available alternates for all requested registrations in a single query
    const { data: totalAlternates, error: alternatesError } = await supabase
      .from('user_alternate_registrations')
      .select('id, registration_id')
      .in('registration_id', registrationIds)

    if (alternatesError) {
      logger.logSystem('get-alternates-batch-error', 'Failed to fetch alternates counts for batch', {
        registrationIds,
        error: alternatesError.message
      })
    }

    const totalAvailableCountByRegistration = new Map<string, number>()
    for (const row of totalAlternates || []) {
      totalAvailableCountByRegistration.set(
        row.registration_id,
        (totalAvailableCountByRegistration.get(row.registration_id) || 0) + 1
      )
    }

    for (const game of games || []) {
      const selectedCount = Array.isArray(game.alternate_selections) ? game.alternate_selections.length : 0
      const totalAvailableCount = totalAvailableCountByRegistration.get(game.registration_id) || 0
      const availableCount = Math.max(0, totalAvailableCount - selectedCount)

      const formattedGame: FormattedGame = {
        id: game.id,
        registrationId: game.registration_id,
        gameDescription: game.game_description,
        gameDate: game.game_date,
        gameEndTime: game.game_end_time,
        createdAt: game.created_at,
        alternateSelections: selectedCount,
        selectedCount,
        availableCount
      }

      if (!gamesByRegistration[game.registration_id]) {
        gamesByRegistration[game.registration_id] = []
      }
      gamesByRegistration[game.registration_id].push(formattedGame)
    }

    return NextResponse.json({ games: gamesByRegistration })

  } catch (error) {
    logger.logSystem('get-games-batch-error', 'Unexpected error fetching games batch', {
      error: error instanceof Error ? error.message : String(error)
    })

    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 })
  }
}
