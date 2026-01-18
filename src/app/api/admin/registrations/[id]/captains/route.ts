import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/registrations/[id]/captains - List captains for a registration
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const registrationId = params.id

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

    // Get captains for this registration
    const { data: captains, error: captainsError } = await supabase
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
      .eq('registration_id', registrationId)

    if (captainsError) {
      console.error('Error fetching captains:', captainsError)
      return NextResponse.json(
        { error: 'Failed to fetch captains' },
        { status: 500 }
      )
    }

    // Flatten the structure
    const processedCaptains = captains?.map(captain => {
      const user = Array.isArray(captain.users) ? captain.users[0] : captain.users
      return {
        id: captain.id,
        user_id: captain.user_id,
        first_name: user?.first_name || '',
        last_name: user?.last_name || '',
        email: user?.email || ''
      }
    }) || []

    return NextResponse.json({ captains: processedCaptains })
  } catch (error) {
    console.error('Error in GET captains API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/admin/registrations/[id]/captains - Add a captain
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const registrationId = params.id
    const body = await request.json()
    const { userId, registrationName, seasonName } = body

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

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

    // Check if already a captain
    const { data: existing } = await supabase
      .from('registration_captains')
      .select('id')
      .eq('registration_id', registrationId)
      .eq('user_id', userId)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'User is already a captain for this registration' },
        { status: 400 }
      )
    }

    // Add captain
    const { data: newCaptain, error: insertError } = await supabase
      .from('registration_captains')
      .insert({
        registration_id: registrationId,
        user_id: userId
      })
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
      .single()

    if (insertError) {
      console.error('Error adding captain:', insertError)
      return NextResponse.json(
        { error: 'Failed to add captain' },
        { status: 500 }
      )
    }

    // Send assignment email via Loops
    const captainUser = Array.isArray(newCaptain.users) ? newCaptain.users[0] : newCaptain.users
    try {
      const loopsResponse = await fetch('https://app.loops.so/api/v1/transactional', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.LOOPS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transactionalId: process.env.LOOPS_CAPTAIN_ASSIGNED_TEMPLATE_ID,
          email: captainUser.email,
          dataVariables: {
            userName: captainUser.first_name,
            registrationName: registrationName,
            seasonName: seasonName,
            captainDashboardUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/user/captain`,
            dashboardUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/user`
          }
        })
      })

      if (!loopsResponse.ok) {
        console.error('Failed to send captain assignment email:', await loopsResponse.text())
      }
    } catch (emailError) {
      console.error('Error sending captain assignment email:', emailError)
      // Don't fail the request if email fails
    }

    return NextResponse.json({
      success: true,
      captain: {
        id: newCaptain.id,
        user_id: newCaptain.user_id,
        first_name: captainUser?.first_name || '',
        last_name: captainUser?.last_name || '',
        email: captainUser?.email || ''
      }
    })
  } catch (error) {
    console.error('Error in POST captains API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
