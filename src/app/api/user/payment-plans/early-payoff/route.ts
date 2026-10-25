import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { handleEarlyPayoffRequest } from '@/lib/payment-plans/early-payoff-request'
import { logger } from '@/lib/logging/logger'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    // Get current authenticated user
    const { data: { user: authUser } } = await supabase.auth.getUser()

    if (!authUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { planId } = body

    if (!planId) {
      return NextResponse.json(
        { error: 'Plan ID is required' },
        { status: 400 }
      )
    }

    return await handleEarlyPayoffRequest(supabase, authUser.id, planId)
  } catch (error) {
    logger.logPaymentProcessing('early-payoff-unexpected-error', 'Unexpected error processing early payoff', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
