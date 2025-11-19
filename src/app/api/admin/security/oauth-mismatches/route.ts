import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify user is admin
    const { data: adminCheck, error: adminError } = await supabase
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

    // Call the database function to get OAuth/email mismatches
    const { data: mismatches, error: mismatchError } = await supabase.rpc(
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
