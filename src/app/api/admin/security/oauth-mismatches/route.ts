import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // First verify the user is authenticated and is an admin using their session
    const userSupabase = await createClient()
    const { data: { user }, error: authError } = await userSupabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify user is admin
    const { data: adminCheck, error: adminError } = await userSupabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (adminError || !adminCheck?.is_admin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      )
    }

    // Now use service role client to call the admin function
    const adminSupabase = createAdminClient()
    const { data: mismatches, error: mismatchError } = await adminSupabase.rpc(
      'get_oauth_email_mismatches'
    )

    if (mismatchError) {
      console.error('Error fetching OAuth mismatches:', mismatchError)
      return NextResponse.json(
        { error: 'Failed to fetch OAuth mismatches', details: mismatchError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      mismatches: mismatches || [],
      count: mismatches?.length || 0
    })

  } catch (error) {
    console.error('Unexpected error in oauth-mismatches:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
