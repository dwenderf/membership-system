import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'

// GET /api/user/alternate-registrations - Get user's alternate registrations with selection history
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's alternate registrations with selection history
    const { data: alternateRegistrations, error } = await supabase
      .from('user_alternate_registrations')
      .select(`
        id,
        registered_at,
        discount_code_id,
        registrations!inner (
          id,
          name,
          alternate_price,
          seasons (
            name,
            start_date,
            end_date
          )
        ),
        discount_codes (
          code,
          percentage
        )
      `)
      .eq('user_id', authUser.id)
      .order('registered_at', { ascending: false })

    if (error) {
      logger.logSystem('get-user-alternate-registrations-error', 'Failed to fetch user alternate registrations', {
        userId: authUser.id,
        error: error.message
      })
      
      return NextResponse.json({ 
        error: 'Failed to fetch alternate registrations' 
      }, { status: 500 })
    }

    // Get user's alternate selections (games they've been selected for)
    const { data: alternateSelections, error: selectionsError } = await supabase
      .from('alternate_selections')
      .select(`
        id,
        selected_at,
        payment_status,
        payment_amount,
        alternate_registrations!inner (
          game_description,
          game_date,
          registrations!inner (
            name
          )
        ),
        payments (
          id,
          status,
          final_amount,
          completed_at
        )
      `)
      .eq('user_id', authUser.id)
      .order('selected_at', { ascending: false })

    if (selectionsError) {
      logger.logSystem('get-user-alternate-selections-error', 'Failed to fetch user alternate selections', {
        userId: authUser.id,
        error: selectionsError.message
      })
      
      return NextResponse.json({ 
        error: 'Failed to fetch alternate selections' 
      }, { status: 500 })
    }

    // Get user's payment method status
    const { data: user } = await supabase
      .from('users')
      .select('stripe_payment_method_id, setup_intent_status')
      .eq('id', authUser.id)
      .single()

    const hasValidPaymentMethod = !!user?.stripe_payment_method_id

    // Calculate statistics
    const totalGamesPlayed = alternateSelections?.filter(s => s.payment_status === 'paid').length || 0
    const totalAmountPaid = alternateSelections?.reduce((sum, s) => {
      return sum + (s.payment_status === 'paid' ? (s.payment_amount || 0) : 0)
    }, 0) || 0

    return NextResponse.json({
      alternateRegistrations: alternateRegistrations || [],
      alternateSelections: alternateSelections || [],
      paymentMethodStatus: {
        hasValidPaymentMethod,
        message: hasValidPaymentMethod 
          ? 'Payment method is set up and ready for alternate selection'
          : 'Payment method setup required for alternate selection'
      },
      statistics: {
        totalRegistrations: alternateRegistrations?.length || 0,
        totalGamesPlayed,
        totalAmountPaid,
        pendingPayments: alternateSelections?.filter(s => s.payment_status === 'pending').length || 0
      }
    })

  } catch (error) {
    logger.logSystem('get-user-alternate-registrations-error', 'Unexpected error fetching user alternate data', {
      error: error instanceof Error ? error.message : String(error)
    })
    
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}