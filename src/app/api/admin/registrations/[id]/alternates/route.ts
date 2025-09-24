import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'

// PUT /api/admin/registrations/[id]/alternates - Update registration alternate configuration
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    // Check authentication and admin status
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

    const body = await request.json()
    const { allow_alternates, alternate_price, alternate_accounting_code } = body

    // Validate required fields when alternates are enabled
    if (allow_alternates) {
      if (!alternate_price || alternate_price <= 0) {
        return NextResponse.json({ 
          error: 'Alternate price is required and must be greater than 0' 
        }, { status: 400 })
      }

      if (!alternate_accounting_code || !alternate_accounting_code.trim()) {
        return NextResponse.json({ 
          error: 'Alternate accounting code is required' 
        }, { status: 400 })
      }
    }

    // Check if registration exists
    const { data: registration, error: registrationError } = await supabase
      .from('registrations')
      .select('id, name')
      .eq('id', id)
      .single()

    if (registrationError || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    // Update registration alternate configuration
    const updateData = {
      allow_alternates,
      alternate_price: allow_alternates ? Math.round(alternate_price * 100) : null, // Convert to cents
      alternate_accounting_code: allow_alternates ? alternate_accounting_code.trim() : null,
      updated_at: new Date().toISOString()
    }

    const { error: updateError } = await supabase
      .from('registrations')
      .update(updateData)
      .eq('id', id)

    if (updateError) {
      logger.logSystem('registration-alternate-update-failed', 'Failed to update registration alternate configuration', {
        registrationId: id,
        adminUserId: authUser.id,
        error: updateError.message
      })
      
      return NextResponse.json({ 
        error: 'Failed to update alternate configuration' 
      }, { status: 500 })
    }

    // If alternates are being disabled, remove all alternate registrations for this registration
    if (!allow_alternates) {
      const { error: cleanupError } = await supabase
        .from('user_alternate_registrations')
        .delete()
        .eq('registration_id', id)

      if (cleanupError) {
        logger.logSystem('alternate-cleanup-warning', 'Failed to clean up alternate registrations', {
          registrationId: id,
          error: cleanupError.message
        })
        // Don't fail the request - the main update succeeded
      }
    }

    logger.logSystem('registration-alternate-updated', 'Registration alternate configuration updated', {
      registrationId: id,
      registrationName: registration.name,
      adminUserId: authUser.id,
      allowAlternates: allow_alternates,
      alternatePrice: allow_alternates ? alternate_price : null,
      alternateAccountingCode: allow_alternates ? alternate_accounting_code : null
    })

    return NextResponse.json({
      success: true,
      message: 'Alternate configuration updated successfully',
      configuration: {
        allow_alternates,
        alternate_price: allow_alternates ? alternate_price : null,
        alternate_accounting_code: allow_alternates ? alternate_accounting_code : null
      }
    })

  } catch (error) {
    logger.logSystem('registration-alternate-update-error', 'Unexpected error updating registration alternate configuration', {
      error: error instanceof Error ? error.message : String(error)
    })
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}