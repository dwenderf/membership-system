import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Database } from '@/types/database'
import { logger } from '@/lib/logging/logger'
import { getStripe } from '@/lib/stripe/server-client'

/**
 * Browser-facing registration status updates.
 *
 * The browser may only move its own in-flight reservation to 'processing'
 * (after Stripe accepted the card, so the reservation stops expiring) or to
 * 'failed' (after a decline). 'paid' is never accepted here: it is set
 * server-side only, by the Stripe webhook, /api/confirm-registration-payment
 * (after it has retrieved a succeeded PaymentIntent from Stripe) or the
 * zero-cost flow in /api/create-registration-payment-intent.
 */
const CLIENT_REGISTRATION_STATUSES = ['processing', 'failed'] as const
type ClientRegistrationStatus = (typeof CLIENT_REGISTRATION_STATUSES)[number]

// Only an unfinished reservation can be moved by the browser.
const UPDATABLE_FROM_STATUSES = ['awaiting_payment', 'processing']

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { registrationId, categoryId, status, stripePaymentIntentId } = body ?? {}

    if (!registrationId || !categoryId || !status) {
      return NextResponse.json({
        error: 'Missing required fields: registrationId, categoryId, status'
      }, { status: 400 })
    }

    if (!CLIENT_REGISTRATION_STATUSES.includes(status)) {
      return NextResponse.json({
        error: `Invalid status. Must be one of: ${CLIENT_REGISTRATION_STATUSES.join(', ')}`
      }, { status: 400 })
    }
    const nextStatus = status as ClientRegistrationStatus

    if (nextStatus === 'processing' && !stripePaymentIntentId) {
      return NextResponse.json({
        error: 'stripePaymentIntentId is required for status processing'
      }, { status: 400 })
    }

    const { data: reservations, error: lookupError } = await adminSupabase
      .from('user_registrations')
      .select('id, payment_status')
      .eq('user_id', user.id)
      .eq('registration_id', registrationId)
      .eq('registration_category_id', categoryId)
      .in('payment_status', UPDATABLE_FROM_STATUSES)

    if (lookupError) {
      logger.logSystem('registration-status-update-error', 'Error looking up registration', { userId: user.id, registrationId, categoryId, status: nextStatus, error: lookupError.message }, 'error')
      return NextResponse.json({ error: 'Failed to update registration status' }, { status: 500 })
    }

    let targetIds: string[] = (reservations ?? []).map((r: { id: string }) => r.id)
    if (targetIds.length === 0) {
      return NextResponse.json({ error: 'No registration found to update' }, { status: 404 })
    }

    const updateData: Database['public']['Tables']['user_registrations']['Update'] = {
      payment_status: nextStatus,
      // Clear expiration so failed rows don't block capacity and processing rows
      // aren't released while Stripe is still settling.
      reservation_expires_at: null,
    }

    if (nextStatus === 'processing') {
      // The PaymentIntent must be the one the server created for this user,
      // registration and category (its metadata is written server-side only).
      let intentMatches = false
      try {
        const intent = await getStripe().paymentIntents.retrieve(String(stripePaymentIntentId))
        const md = intent.metadata || {}
        intentMatches =
          md.userId === user.id &&
          md.registrationId === registrationId &&
          md.categoryId === categoryId &&
          (!md.reservationId || targetIds.includes(md.reservationId))
        if (intentMatches && md.reservationId) {
          targetIds = [md.reservationId]
        }
      } catch (stripeError) {
        logger.logPaymentProcessing('registration-status-intent-lookup-failed', 'Could not retrieve payment intent', { userId: user.id, registrationId, error: stripeError instanceof Error ? stripeError.message : String(stripeError) }, 'warn')
      }
      if (!intentMatches) {
        return NextResponse.json({ error: 'Payment intent does not match this registration' }, { status: 400 })
      }
      updateData.stripe_payment_intent_id = stripePaymentIntentId
    }

    const { data, error } = await adminSupabase
      .from('user_registrations')
      .update(updateData)
      .in('id', targetIds)
      .eq('user_id', user.id)
      .in('payment_status', UPDATABLE_FROM_STATUSES)
      .select()

    if (error) {
      logger.logSystem('registration-status-update-error', 'Error updating registration status', { userId: user.id, registrationId, categoryId, status: nextStatus, error: error.message }, 'error')
      return NextResponse.json({ error: 'Failed to update registration status' }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'No registration found to update' }, { status: 404 })
    }

    logger.logSystem('registration-status-updated', `Updated registration status to '${nextStatus}'`, { userId: user.id, registrationId, categoryId, status: nextStatus }, 'debug')

    return NextResponse.json({
      success: true,
      updated: data.length,
      registration: data[0]
    })
  } catch (error) {
    logger.logSystem('registration-status-update-unexpected-error', 'Unexpected error updating registration status', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
