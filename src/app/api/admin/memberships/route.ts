import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/memberships - List all memberships
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (userError || !userData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get all memberships
    const { data: memberships, error } = await supabase
      .from('memberships')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching memberships:', error)
      return NextResponse.json({ error: 'Failed to fetch memberships' }, { status: 500 })
    }

    return NextResponse.json({ memberships })
    
  } catch (error) {
    console.error('Error in memberships API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}