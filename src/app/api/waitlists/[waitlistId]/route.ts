import { createClient, createAdminClient } from '@/lib/supabase/server'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'
import { stageWaitlistRemovedEmail } from '@/lib/email/waitlist-notifications'

// DELETE /api/waitlists/[waitlistId] - Remove a waitlist entry (leave, or captain/admin removal)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ waitlistId: string }> }
) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { waitlistId } = await params

    const { data: waitlistEntry, error: waitlistError } = await adminSupabase
      .from('waitlists')
      .select('id, user_id, registration_id, registration_category_id, removed_at')
      .eq('id', waitlistId)
      .single()

    if (waitlistError || !waitlistEntry) {
      return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
    }

    if (waitlistEntry.removed_at) {
      return NextResponse.json({
        error: 'This waitlist entry has already been removed'
      }, { status: 400 })
    }

    const isSelf = waitlistEntry.user_id === authUser.id

    let isAuthorized = isSelf

    if (!isAuthorized) {
      const { data: userProfile } = await supabase
        .from('users')
        .select('is_admin')
        .eq('id', authUser.id)
        .single()
      isAuthorized = !!userProfile?.is_admin
    }

    if (!isAuthorized) {
      const { data: captainship } = await supabase
        .from('registration_captains')
        .select('id')
        .eq('user_id', authUser.id)
        .eq('registration_id', waitlistEntry.registration_id)
        .maybeSingle()
      isAuthorized = !!captainship
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Not authorized to remove this waitlist entry' }, { status: 403 })
    }

    const { error: updateError } = await adminSupabase
      .from('waitlists')
      .update({ removed_at: new Date().toISOString() })
      .eq('id', waitlistId)

    if (updateError) {
      logger.logSystem('waitlist-removal-failed', 'Failed to remove waitlist entry', {
        waitlistId,
        error: updateError.message
      })
      return NextResponse.json({ error: 'Failed to remove waitlist entry' }, { status: 500 })
    }

    stageWaitlistRemovedEmail(
      waitlistEntry.registration_id,
      waitlistEntry.user_id,
      waitlistEntry.registration_category_id
    ).catch((err) => logger.logSystem('waitlist-removal-notify', 'Waitlist removed notification failed (non-fatal)', { error: err?.message }))

    logger.logSystem('waitlist-removal-success', 'Successfully removed waitlist entry', {
      waitlistId,
      userId: waitlistEntry.user_id,
      registrationId: waitlistEntry.registration_id,
      removedBy: authUser.id
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    logger.logSystem('waitlist-removal-error', 'Unexpected error removing waitlist entry', {
      error: error instanceof Error ? error.message : String(error)
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
