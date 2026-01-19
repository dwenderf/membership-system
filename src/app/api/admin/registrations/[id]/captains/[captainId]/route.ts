import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// DELETE /api/admin/registrations/[id]/captains/[captainId] - Remove a captain
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; captainId: string } }
) {
  try {
    const supabase = await createClient()
    const registrationId = params.id
    const captainId = params.captainId
    const body = await request.json()
    const { registrationName, seasonName } = body

    // Check if user is admin
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
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

    // Get captain details before deleting (for email)
    const { data: captain, error: captainError } = await supabase
      .from('registration_captains')
      .select(`
        id,
        user_id,
        users!registration_captains_user_id_fkey!inner (
          id,
          email,
          first_name,
          last_name
        )
      `)
      .eq('id', captainId)
      .eq('registration_id', registrationId)
      .single()

    if (captainError || !captain) {
      return NextResponse.json(
        { error: 'Captain not found' },
        { status: 404 }
      )
    }

    // Delete captain
    const { error: deleteError } = await supabase
      .from('registration_captains')
      .delete()
      .eq('id', captainId)
      .eq('registration_id', registrationId)

    if (deleteError) {
      console.error('Error deleting captain:', deleteError)
      return NextResponse.json(
        { error: 'Failed to remove captain' },
        { status: 500 }
      )
    }

    // Send removal email via Loops
    const captainUser = Array.isArray(captain.users) ? captain.users[0] : captain.users
    try {
      const loopsResponse = await fetch('https://app.loops.so/api/v1/transactional', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.LOOPS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transactionalId: process.env.LOOPS_CAPTAIN_REMOVAL_NOTIFICATION_TEMPLATE_ID,
          email: captainUser.email,
          dataVariables: {
            userName: captainUser.first_name,
            registrationName: registrationName,
            seasonName: seasonName,
            dashboardUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/user`
          }
        })
      })

      if (!loopsResponse.ok) {
        console.error('Failed to send captain removal email:', await loopsResponse.text())
      }
    } catch (emailError) {
      console.error('Error sending captain removal email:', emailError)
      // Don't fail the request if email fails
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE captain API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
