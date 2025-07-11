import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { registrationId, categoryId, status, userMembershipId, registeredAt, stripePaymentIntentId } = body
    
    if (!registrationId || !categoryId || !status) {
      return NextResponse.json({ 
        error: 'Missing required fields: registrationId, categoryId, status' 
      }, { status: 400 })
    }

    // Validate status
    const validStatuses = ['awaiting_payment', 'processing', 'paid', 'failed', 'refunded']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      }, { status: 400 })
    }

    // Build update object based on status and provided fields
    const updateData: any = {
      payment_status: status,
    }

    // Clear expiration when processing, paid, or failed (so failed records don't block capacity)
    if (status === 'processing' || status === 'paid' || status === 'failed') {
      updateData.reservation_expires_at = null
    }

    // Add optional fields if provided
    if (userMembershipId !== undefined) {
      updateData.user_membership_id = userMembershipId
    }

    if (registeredAt !== undefined) {
      updateData.registered_at = registeredAt
    } else if (status === 'paid') {
      // Auto-set registered_at when marking as paid
      updateData.registered_at = new Date().toISOString()
    }

    if (stripePaymentIntentId !== undefined) {
      updateData.stripe_payment_intent_id = stripePaymentIntentId
    }

    // Update the registration status (using admin client to bypass RLS)
    const { data, error } = await adminSupabase
      .from('user_registrations')
      .update(updateData)
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .eq('registration_category_id', categoryId)
      .select()

    if (error) {
      console.error('Error updating registration status:', error)
      return NextResponse.json({ 
        error: 'Failed to update registration status' 
      }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ 
        error: 'No registration found to update' 
      }, { status: 404 })
    }

    console.log(`✅ Updated registration status to '${status}' for user ${user.id}`)

    return NextResponse.json({ 
      success: true, 
      updated: data.length,
      registration: data[0]
    })
    
  } catch (error) {
    console.error('Error updating registration status:', error)
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}