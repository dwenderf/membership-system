import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

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

    // Delete awaiting_payment records for this user/registration using admin client to bypass RLS
    const adminSupabase = createAdminClient()
    const { data: deletedRecords, error: deleteError } = await adminSupabase
      .from('user_registrations')
      .delete()
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .eq('payment_status', 'awaiting_payment')
      .select()
      
    logger.logSystem('cleanup-processing-reservation-deleted', `Deleted ${deletedRecords?.length || 0} awaiting_payment records`, { userId: user.id, registrationId, deletedCount: deletedRecords?.length || 0 }, 'debug')

    if (deleteError) {
      logger.logSystem('cleanup-processing-reservation-delete-error', 'Error deleting awaiting_payment record', { userId: user.id, registrationId, error: deleteError.message }, 'error')
      return NextResponse.json({ error: 'Failed to cleanup reservation' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
    
  } catch (error) {
    logger.logSystem('cleanup-processing-reservation-unexpected-error', 'Error in cleanup processing reservation', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}