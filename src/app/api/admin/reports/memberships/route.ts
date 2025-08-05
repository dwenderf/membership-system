import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    
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

    // Get membership ID from query params
    const membershipId = searchParams.get('membershipId')

    // Use admin client to access the secured view
    const adminSupabase = await createAdminClient()

    if (membershipId) {
      // Get specific membership data
      const { data: membershipData, error: membershipError } = await adminSupabase
        .from('membership_analytics_data')
        .select('*')
        .eq('membership_id', membershipId)
        .order('last_name', { ascending: true })

      if (membershipError) {
        console.error('Error fetching membership data:', membershipError)
        return NextResponse.json({ error: 'Failed to fetch membership data' }, { status: 500 })
      }

      return NextResponse.json({ data: membershipData })
    } else {
      // Get all membership types
      const { data: membershipTypes, error: typesError } = await adminSupabase
        .from('memberships')
        .select('id, name, description')
        .order('name')

      if (typesError) {
        console.error('Error fetching membership types:', typesError)
        return NextResponse.json({ error: 'Failed to fetch membership types' }, { status: 500 })
      }

      return NextResponse.json({ data: membershipTypes })
    }
  } catch (error) {
    console.error('Error in membership reports API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 