import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const registrationId = searchParams.get('registrationId')
    
    if (!registrationId) {
      return NextResponse.json({ error: 'Registration ID required' }, { status: 400 })
    }

    // Delete processing records for this user/registration
    const { error: deleteError } = await supabase
      .from('user_registrations')
      .delete()
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .eq('payment_status', 'processing')

    if (deleteError) {
      console.error('Error deleting processing record:', deleteError)
      return NextResponse.json({ error: 'Failed to cleanup reservation' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
    
  } catch (error) {
    console.error('Error in cleanup processing reservation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}