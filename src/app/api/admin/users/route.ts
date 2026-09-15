import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '100', 10)

    // Check if user is authenticated and is admin
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: userData, error: userDataError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (userDataError || !userData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Fetch users with limit
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, member_id')
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true })
      .limit(limit)

    if (usersError) {
      logger.logAdminAction('users-fetch-error', 'Error fetching users', { error: usersError.message }, user.id, 'error')
      return NextResponse.json(
        { error: 'Failed to fetch users' },
        { status: 500 }
      )
    }

    return NextResponse.json({ users: users || [] })
  } catch (error) {
    logger.logAdminAction('users-fetch-exception', 'Unexpected error in GET users API', { error: error instanceof Error ? error.message : String(error) }, undefined, 'error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
