import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { emailService } from '@/lib/email/service'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { id: registrationId } = await params

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify the user is a captain of this registration
    const { data: captainship } = await supabase
      .from('registration_captains')
      .select('id')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .single()

    if (!captainship) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { subject, body: messageBody, recipientUserIds } = body

    if (!subject?.trim()) {
      return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
    }
    if (!messageBody?.trim()) {
      return NextResponse.json({ error: 'Message body is required' }, { status: 400 })
    }
    if (!Array.isArray(recipientUserIds) || recipientUserIds.length === 0) {
      return NextResponse.json({ error: 'At least one recipient is required' }, { status: 400 })
    }

    const adminSupabase = createAdminClient()

    // Fetch sender profile
    const { data: senderProfile } = await adminSupabase
      .from('users')
      .select('email, first_name, last_name')
      .eq('id', user.id)
      .single()

    const firstName = senderProfile?.first_name || ''
    const lastInitial = senderProfile?.last_name?.[0] || ''
    const senderName = `${firstName} ${lastInitial}`.trim()

    // Fetch registration name for senderRole
    const { data: registration } = await adminSupabase
      .from('registrations')
      .select('name')
      .eq('id', registrationId)
      .single()

    const senderRole = `Captain – ${registration?.name || 'Team'}`

    // Verify recipients are either active paid members or active waitlist
    // entries for this registration — never trust the client's recipient list.
    const { data: validMembers } = await adminSupabase
      .from('user_registrations')
      .select('user_id, users!inner(id, email, first_name, last_name)')
      .eq('registration_id', registrationId)
      .eq('payment_status', 'paid')
      .in('user_id', recipientUserIds)

    const { data: validWaitlisted } = await adminSupabase
      .from('waitlists')
      .select('user_id, users!waitlists_user_id_fkey(id, email, first_name, last_name)')
      .eq('registration_id', registrationId)
      .is('removed_at', null)
      .in('user_id', recipientUserIds)

    const recipientMap = new Map<string, { userId: string; email: string; name: string }>()
    ;[...(validMembers || []), ...(validWaitlisted || [])].forEach(m => {
      const u = Array.isArray(m.users) ? m.users[0] : m.users
      if (!u) return
      recipientMap.set(m.user_id, {
        userId: m.user_id,
        email: u.email,
        name: `${u.first_name} ${u.last_name}`.trim(),
      })
    })

    if (recipientMap.size === 0) {
      return NextResponse.json({ error: 'No valid recipients found' }, { status: 400 })
    }

    const recipients = Array.from(recipientMap.values())

    // Always CC the sender
    if (senderProfile?.email && !recipients.some(r => r.userId === user.id)) {
      recipients.push({
        userId: user.id,
        email: senderProfile.email,
        name: `${senderProfile.first_name || ''} ${senderProfile.last_name || ''}`.trim(),
      })
    }

    await emailService.stageTeamMessageEmail(recipients, {
      senderName,
      senderRole,
      messageSubject: subject.trim(),
      messageBody: messageBody.trim(),
    })

    return NextResponse.json({ queued: recipients.length })
  } catch (error) {
    console.error('Error in captain send-team-email:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
