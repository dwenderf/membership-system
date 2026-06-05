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

    // Verify admin
    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin, email, first_name, last_name')
      .eq('id', user.id)
      .single()

    if (!userProfile?.is_admin) {
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

    const firstName = userProfile.first_name || ''
    const lastInitial = userProfile.last_name?.[0] || ''
    const senderName = `${firstName} ${lastInitial}`.trim()

    // Fetch registration name for senderRole
    const { data: registration } = await adminSupabase
      .from('registrations')
      .select('name')
      .eq('id', registrationId)
      .single()

    const senderRole = `Admin – ${registration?.name || 'Team'}`

    // Verify recipients are active paid members of this registration
    const { data: validMembers } = await adminSupabase
      .from('user_registrations')
      .select('user_id, users!inner(id, email, first_name, last_name)')
      .eq('registration_id', registrationId)
      .eq('payment_status', 'paid')
      .in('user_id', recipientUserIds)

    if (!validMembers || validMembers.length === 0) {
      return NextResponse.json({ error: 'No valid recipients found' }, { status: 400 })
    }

    const recipients = validMembers.map(m => {
      const u = Array.isArray(m.users) ? m.users[0] : m.users
      return {
        userId: m.user_id,
        email: u.email,
        name: `${u.first_name} ${u.last_name}`.trim(),
      }
    })

    // Always CC the sender
    if (userProfile.email && !recipients.some(r => r.userId === user.id)) {
      recipients.push({
        userId: user.id,
        email: userProfile.email,
        name: `${userProfile.first_name || ''} ${userProfile.last_name || ''}`.trim(),
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
    console.error('Error in admin send-team-email:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
