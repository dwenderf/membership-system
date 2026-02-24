import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const logger = Logger.getInstance()

  try {
    const { id } = await params
    // Check if current user is admin
    const { data: { user: authUser } } = await supabase.auth.getUser()
    
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get the target user
    const { data: targetUser, error: userError } = await supabase
      .from('users')
      .select('is_admin, first_name, last_name, email')
      .eq('id', id)
      .single()

    if (userError || !targetUser) {
      logger.logSystem('toggle-admin-error', 'User not found', { 
        targetUserId: id,
        error: userError?.message 
      })
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Prevent admin from removing their own admin access
    if (id === authUser.id) {
      return NextResponse.json({ error: 'Cannot modify your own admin status' }, { status: 400 })
    }

    // Toggle admin status
    const newAdminStatus = !targetUser.is_admin
    
    const { error: updateError } = await supabase
      .from('users')
      .update({ is_admin: newAdminStatus })
      .eq('id', id)

    if (updateError) {
      logger.logSystem('toggle-admin-error', 'Failed to update admin status', { 
        targetUserId: id,
        error: updateError.message 
      })
      return NextResponse.json({ error: 'Failed to update admin status' }, { status: 500 })
    }

    // Log the action
    logger.logSystem('admin-status-changed', 'Admin status changed', {
      targetUserId: id,
      targetUserName: `${targetUser.first_name} ${targetUser.last_name}`,
      targetUserEmail: targetUser.email,
      newAdminStatus,
      changedByUserId: authUser.id
    })

    return NextResponse.json({ 
      success: true, 
      is_admin: newAdminStatus,
      message: `Admin access ${newAdminStatus ? 'granted' : 'revoked'} successfully`
    })

  } catch (error) {
    logger.logSystem('toggle-admin-error', 'Unexpected error toggling admin status', { 
      targetUserId: id,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
