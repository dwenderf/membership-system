import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ registrationId: string }> }
) {
  try {
    const { registrationId } = await params
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!registrationId) {
      return NextResponse.json({ error: 'Registration ID is required' }, { status: 400 })
    }

    // Check if user has an alternate registration for this registration
    const { data: existingAlternate, error: fetchError } = await supabase
      .from('user_alternate_registrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .single()

    if (fetchError || !existingAlternate) {
      return NextResponse.json({ error: 'Alternate registration not found' }, { status: 404 })
    }

    // Delete the alternate registration
    const { error: deleteError } = await supabase
      .from('user_alternate_registrations')
      .delete()
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)

    if (deleteError) {
      console.error('Error deleting alternate registration:', deleteError)
      return NextResponse.json({ error: 'Failed to remove alternate registration' }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true,
      message: 'Alternate registration removed successfully'
    })

  } catch (error) {
    console.error('Error in DELETE alternate registration:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}