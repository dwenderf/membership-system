import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

/**
 * PUT /api/user/preferences
 *
 * Updates the authenticated user's preferences JSON.
 * Merges the provided fields into the existing preferences object.
 */
export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    // Fetch existing preferences first so we can merge
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('preferences')
      .eq('id', user.id)
      .single()

    if (fetchError) {
      logger.logSystem('preferences-fetch-error', 'Error fetching user preferences', { userId: user.id, error: fetchError.message }, 'error')
      return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 })
    }

    const merged = { ...(existingUser?.preferences ?? {}), ...body }

    const { error: updateError } = await supabase
      .from('users')
      .update({ preferences: merged })
      .eq('id', user.id)

    if (updateError) {
      logger.logSystem('preferences-update-error', 'Error updating user preferences', { userId: user.id, error: updateError.message }, 'error')
      return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 })
    }

    return NextResponse.json({ preferences: merged })
  } catch (error) {
    logger.logSystem('preferences-unexpected-error', 'Error in preferences API', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
