import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id: registrationId } = params
    const body = await request.json()
    const { name } = body
    
    if (!registrationId) {
      return NextResponse.json({ error: 'Registration ID required' }, { status: 400 })
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Valid name required' }, { status: 400 })
    }

    // Update the registration name
    const { data, error } = await supabase
      .from('registrations')
      .update({ name: name.trim() })
      .eq('id', registrationId)
      .select()
      .single()
    
    if (error) {
      console.error('Error updating registration name:', error)
      return NextResponse.json({ error: 'Failed to update registration name' }, { status: 500 })
    }
    
    if (!data) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }
    
    return NextResponse.json({ 
      success: true, 
      registration: data 
    })
    
  } catch (error) {
    console.error('Error in registration name update API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}