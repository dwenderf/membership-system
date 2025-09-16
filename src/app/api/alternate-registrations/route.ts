import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'

// GET /api/alternate-registrations - Get games for a registration
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get registrationId from query params
    const { searchParams } = new URL(request.url)
    const registrationId = searchParams.get('registrationId')

    if (!registrationId) {
      return NextResponse.json({ error: 'Registration ID is required' }, { status: 400 })
    }

    // Check if user is admin (for now, we'll add captain check later)
    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!userProfile?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get registration details to verify it exists and get pricing info
    const { data: registration, error: registrationError } = await supabase
      .from('registrations')
      .select(`
        id,
        name,
        allow_alternates,
        alternate_price,
        alternate_accounting_code,
        seasons (
          name
        )
      `)
      .eq('id', registrationId)
      .single()

    if (registrationError || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    // Get games for this registration with selection counts
    const { data: games, error: gamesError } = await supabase
      .from('alternate_registrations')
      .select(`
        id,
        registration_id,
        game_description,
        game_date,
        created_at,
        created_by,
        alternate_selections (
          id
        )
      `)
      .eq('registration_id', registrationId)
      .order('game_date', { ascending: false })

    if (gamesError) {
      logger.logSystem('get-games-error', 'Failed to fetch games', {
        registrationId,
        error: gamesError.message
      })
      
      return NextResponse.json({ 
        error: 'Failed to fetch games' 
      }, { status: 500 })
    }

    // Format games data
    const formattedGames = (games || []).map(game => ({
      id: game.id,
      registrationId: game.registration_id,
      registrationName: registration.name,
      seasonName: registration.seasons?.name || 'Unknown Season',
      gameDescription: game.game_description,
      gameDate: game.game_date,
      alternatePrice: registration.alternate_price || 0,
      alternateAccountingCode: registration.alternate_accounting_code || '',
      createdAt: game.created_at,
      alternateSelections: game.alternate_selections?.length || 0
    }))

    return NextResponse.json({
      games: formattedGames,
      registration: {
        id: registration.id,
        name: registration.name,
        allowAlternates: registration.allow_alternates,
        alternatePrice: registration.alternate_price,
        alternateAccountingCode: registration.alternate_accounting_code
      }
    })

  } catch (error) {
    logger.logSystem('get-games-error', 'Unexpected error fetching games', {
      error: error instanceof Error ? error.message : String(error)
    })
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

// POST /api/alternate-registrations - Create a new game
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { registrationId, gameDescription, gameDate } = body

    // Validate required fields
    if (!registrationId) {
      return NextResponse.json({ error: 'Registration ID is required' }, { status: 400 })
    }

    if (!gameDescription || gameDescription.trim().length === 0) {
      return NextResponse.json({ error: 'Game description is required' }, { status: 400 })
    }

    // Check if user is admin (for now, we'll add captain check later)
    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!userProfile?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Verify registration exists and allows alternates
    const { data: registration, error: registrationError } = await supabase
      .from('registrations')
      .select('id, name, allow_alternates, alternate_price, alternate_accounting_code')
      .eq('id', registrationId)
      .single()

    if (registrationError || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    if (!registration.allow_alternates) {
      return NextResponse.json({ 
        error: 'This registration does not allow alternates' 
      }, { status: 400 })
    }

    if (!registration.alternate_price || !registration.alternate_accounting_code) {
      return NextResponse.json({ 
        error: 'Registration must have alternate price and accounting code configured' 
      }, { status: 400 })
    }

    // Create the game
    const { data: newGame, error: insertError } = await supabase
      .from('alternate_registrations')
      .insert({
        registration_id: registrationId,
        game_description: gameDescription.trim(),
        game_date: gameDate || null,
        created_by: authUser.id
      })
      .select(`
        id,
        registration_id,
        game_description,
        game_date,
        created_at,
        created_by
      `)
      .single()

    if (insertError) {
      logger.logSystem('create-game-failed', 'Failed to create game', {
        registrationId,
        gameDescription,
        error: insertError.message
      })
      
      return NextResponse.json({ 
        error: 'Failed to create game. Please try again.' 
      }, { status: 500 })
    }

    logger.logSystem('game-created', 'Game created successfully', {
      gameId: newGame.id,
      registrationId,
      gameDescription,
      createdBy: authUser.id
    })

    // Format response
    const formattedGame = {
      id: newGame.id,
      registrationId: newGame.registration_id,
      registrationName: registration.name,
      gameDescription: newGame.game_description,
      gameDate: newGame.game_date,
      alternatePrice: registration.alternate_price,
      alternateAccountingCode: registration.alternate_accounting_code,
      createdAt: newGame.created_at,
      alternateSelections: 0
    }

    return NextResponse.json({
      success: true,
      game: formattedGame,
      message: 'Game created successfully'
    })

  } catch (error) {
    logger.logSystem('create-game-error', 'Unexpected error creating game', {
      error: error instanceof Error ? error.message : String(error)
    })
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}