import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { bulkSyncMissingContacts, syncUserToXeroContact } from '@/lib/xero-contacts'

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    
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

    const body = await request.json()
    const { tenant_id, user_id, bulk_sync } = body

    if (!tenant_id) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 })
    }

    if (bulk_sync) {
      // Bulk sync all missing contacts
      const result = await bulkSyncMissingContacts(tenant_id)
      
      return NextResponse.json({
        success: result.success,
        message: result.success 
          ? `Bulk sync completed. ${result.synced} contacts synced, ${result.failed} failed.`
          : 'Bulk sync failed',
        synced: result.synced,
        failed: result.failed,
        errors: result.errors
      })

    } else if (user_id) {
      // Sync specific user
      const { data: userToSync, error: userToSyncError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name, phone')
        .eq('id', user_id)
        .single()

      if (userToSyncError || !userToSync) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      const result = await syncUserToXeroContact(user_id, tenant_id, userToSync)
      
      return NextResponse.json({
        success: result.success,
        message: result.success 
          ? 'Contact synced successfully'
          : `Failed to sync contact: ${result.error}`,
        xero_contact_id: result.xeroContactId,
        error: result.error
      })

    } else {
      return NextResponse.json({ 
        error: 'Either user_id or bulk_sync must be specified' 
      }, { status: 400 })
    }

  } catch (error) {
    console.error('Error in contact sync API:', error)
    return NextResponse.json({ 
      error: 'Failed to sync contacts' 
    }, { status: 500 })
  }
}