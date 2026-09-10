import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { countExpiringMemberships } from '@/lib/services/membership-reminder-processor'

/**
 * Preview how many membership expiration reminders would be sent right now,
 * without staging or sending anything. Powers the "N emails will be sent"
 * count on the admin reminder trigger.
 *
 * GET /api/admin/membership-reminders/count
 *
 * Authorization: Requires authenticated admin user
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()

    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const today = new Date().toISOString().split('T')[0]
    const count = await countExpiringMemberships(today)

    return NextResponse.json({ success: true, count })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 })
  }
}
