import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params

  try {
    const supabase = await createClient()

    // Check if user is authenticated and is admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userProfile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { start_date, end_date } = body

    if (!start_date || !end_date) {
      return NextResponse.json(
        { error: 'Both start_date and end_date are required' },
        { status: 400 }
      )
    }

    // Validate that end_date is after start_date
    if (new Date(end_date) < new Date(start_date)) {
      return NextResponse.json(
        { error: 'End date must be after start date' },
        { status: 400 }
      )
    }

    // Update the registration dates
    const { error: updateError } = await supabase
      .from('registrations')
      .update({
        start_date,
        end_date,
      })
      .eq('id', id)

    if (updateError) {
      logger.logAdminAction('registration-dates-update-error', 'Error updating registration dates', { registrationId: id, error: updateError.message }, user.id, 'error')
      return NextResponse.json(
        { error: 'Failed to update registration dates' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.logAdminAction('registration-dates-update-exception', 'Unexpected error updating registration dates', { registrationId: id, error: error instanceof Error ? error.message : String(error) }, undefined, 'error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
