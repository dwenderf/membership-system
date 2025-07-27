import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { deleteXeroDraftInvoice } from '@/lib/xero/invoices'
import { paymentProcessor } from '@/lib/payment-completion-processor'
import { logger } from '@/lib/logging/logger'

// Force import server config
import '../../../../sentry.server.config'
import * as Sentry from '@sentry/nextjs'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-05-28.basil',
})

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!

// Handle membership payment processing
async function handleMembershipPayment(supabase: any, adminSupabase: any, paymentIntent: Stripe.PaymentIntent, userId: string, membershipId: string, durationMonths: number) {
  // Check if user membership already exists (avoid duplicates)
  const { data: existingMembership } = await supabase
    .from('user_memberships')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .single()

  if (existingMembership) {
    console.log('User membership already exists for payment intent:', paymentIntent.id)
    return
  }

  // Calculate dates - need to determine if this extends an existing membership
  const { data: userMemberships } = await supabase
    .from('user_memberships')
    .select('*')
    .eq('user_id', userId)
    .eq('membership_id', membershipId)
    .gte('valid_until', new Date().toISOString().split('T')[0])
    .order('valid_until', { ascending: false })

  let startDate = new Date()
  if (userMemberships && userMemberships.length > 0) {
    // Extend from the latest expiration date
    startDate = new Date(userMemberships[0].valid_until)
  }

  const endDate = new Date(startDate)
  endDate.setMonth(endDate.getMonth() + durationMonths)

  // Create user membership record (handle duplicate gracefully)
  let membershipRecord: any
  try {
    const { data: newMembership, error: membershipError } = await supabase
    .from('user_memberships')
    .insert({
      user_id: userId,
      membership_id: membershipId,
      valid_from: startDate.toISOString().split('T')[0],
      valid_until: endDate.toISOString().split('T')[0],
      months_purchased: durationMonths,
      payment_status: 'paid',
      stripe_payment_intent_id: paymentIntent.id,
      amount_paid: paymentIntent.amount,
      purchased_at: new Date().toISOString(),
    })
    .select()
    .single()

    if (membershipError) {
      if (membershipError.code === '23505') { // Duplicate key error
        console.log('Membership already exists for payment intent, fetching existing record:', paymentIntent.id)
        const { data: existingMembership, error: fetchError } = await supabase
          .from('user_memberships')
          .select('*')
          .eq('stripe_payment_intent_id', paymentIntent.id)
          .single()
        
        if (fetchError || !existingMembership) {
          console.error('Error fetching existing membership:', fetchError)
          throw new Error('Failed to fetch existing membership')
        }
        
        membershipRecord = existingMembership
      } else {
    console.error('Error creating user membership:', membershipError)
    throw new Error('Failed to create membership')
      }
    } else {
      membershipRecord = newMembership
    }
  } catch (error) {
    console.error('Error in membership creation/fetch:', error)
    throw new Error('Failed to create or fetch membership')
  }

  // Update payment record
  const { data: updatedPayment, error: paymentUpdateError } = await supabase
    .from('payments')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .select()

  if (paymentUpdateError) {
    console.error('❌ Webhook: Error updating membership payment record:', paymentUpdateError)
  } else if (updatedPayment && updatedPayment.length > 0) {
    console.log(`✅ Webhook: Updated membership payment record to completed: ${updatedPayment[0].id}`)
    
    // Update user_memberships record with payment_id
    const { error: membershipUpdateError } = await adminSupabase
      .from('user_memberships')
      .update({ payment_id: updatedPayment[0].id })
      .eq('id', membershipRecord.id)

    if (membershipUpdateError) {
      console.error('❌ Webhook: Error updating membership record with payment_id:', membershipUpdateError)
    } else {
      console.log(`✅ Webhook: Updated membership record with payment_id: ${updatedPayment[0].id}`)
    }
  } else {
    console.warn(`⚠️ Webhook: No membership payment record found for payment intent: ${paymentIntent.id}`)
  }

  // Xero integration is now handled entirely by the payment completion processor
  // This ensures consistent handling of staging records, emails, and batch sync

  // Trigger payment completion processor for emails and post-processing
  console.log('🔄 About to trigger payment completion processor...')
  console.log('🔄 Webhook context:', {
    paymentIntentId: paymentIntent.id,
    userId,
    membershipId,
    durationMonths,
    membershipRecordId: membershipRecord.id,
    updatedPaymentId: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
    amount: paymentIntent.amount
  })
  
  try {
    console.log('🔄 Payment completion processor parameters:', {
      event_type: 'user_memberships',
      record_id: membershipRecord.id,
      user_id: userId,
      payment_id: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
      amount: paymentIntent.amount,
      trigger_source: 'stripe_webhook_membership'
    })
    
    console.log('🔄 Calling paymentProcessor.processPaymentCompletion...')
    const processorResult = await paymentProcessor.processPaymentCompletion({
      event_type: 'user_memberships',
      record_id: membershipRecord.id,
      user_id: userId,
      payment_id: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
      amount: paymentIntent.amount,
      trigger_source: 'stripe_webhook_membership',
      timestamp: new Date().toISOString()
    })
    console.log('✅ Payment completion processor returned successfully:', processorResult)
    console.log('✅ Triggered payment completion processor for membership')
  } catch (processorError) {
    console.error('❌ Failed to trigger payment completion processor for membership:', processorError)
    console.error('❌ Processor error details:', {
      message: processorError instanceof Error ? processorError.message : String(processorError),
      stack: processorError instanceof Error ? processorError.stack : undefined
    })
    // Don't fail the webhook - membership was created successfully
  }

  console.log('Successfully processed membership payment intent:', paymentIntent.id)
}

// Handle registration payment processing
async function handleRegistrationPayment(supabase: any, paymentIntent: Stripe.PaymentIntent, userId: string, registrationId: string) {
  // Note: Webhook doesn't have access to categoryId, so we'll need to get it from the registration
  // For now, let's keep the direct database update in webhooks since they're backup/redundancy
  
  let userRegistration: any
  
  // First, check if registration already exists and is paid
  const { data: existingPaidRegistration } = await supabase
    .from('user_registrations')
    .select('*')
    .eq('user_id', userId)
    .eq('registration_id', registrationId)
    .eq('payment_status', 'paid')
    .single()

  if (existingPaidRegistration) {
    console.log('Registration already paid, using existing record:', existingPaidRegistration.id)
    userRegistration = existingPaidRegistration
  } else {
  // Update user registration record from awaiting_payment/processing to paid
    const { data: updatedRegistration, error: registrationError } = await supabase
    .from('user_registrations')
    .update({
      payment_status: 'paid',
      registered_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('registration_id', registrationId)
    .in('payment_status', ['awaiting_payment', 'processing'])
    .select()
    .single()

    if (registrationError || !updatedRegistration) {
    console.error('Error updating user registration:', registrationError)
      console.error('Registration update failed for:', { userId, registrationId })
      
      // Try to find any registration record for debugging
      const { data: allRegistrations } = await supabase
        .from('user_registrations')
        .select('*')
        .eq('user_id', userId)
        .eq('registration_id', registrationId)
      
      console.error('All registration records found:', allRegistrations)
    throw new Error('Failed to update registration')
    }
    
    userRegistration = updatedRegistration
  }

  // Record discount usage if discount was applied
  const discountCode = paymentIntent.metadata.discountCode
  const discountAmount = parseInt(paymentIntent.metadata.discountAmount || '0')
  const discountCategoryId = paymentIntent.metadata.discountCategoryId

  if (discountCode && discountAmount > 0 && discountCategoryId) {
    // Get the discount code ID
    const { data: discountCodeRecord } = await supabase
      .from('discount_codes')
      .select('id')
      .eq('code', discountCode)
      .single()

    if (discountCodeRecord) {
      // Get season ID from registration
      const { data: registration } = await supabase
        .from('registrations')
        .select('season_id')
        .eq('id', registrationId)
        .single()

      if (registration) {
        // Check if discount usage already exists to prevent duplicates
        const { data: existingUsage } = await supabase
          .from('discount_usage')
          .select('id')
          .eq('user_id', userId)
          .eq('discount_code_id', discountCodeRecord.id)
          .eq('registration_id', registrationId)
          .single()

        if (!existingUsage) {
          // Record discount usage only if it doesn't already exist
        const { error: usageError } = await supabase
          .from('discount_usage')
          .insert({
            user_id: userId,
            discount_code_id: discountCodeRecord.id,
            discount_category_id: discountCategoryId,
            season_id: registration.season_id,
            amount_saved: discountAmount,
            registration_id: registrationId,
          })

        if (usageError) {
          console.error('Error recording discount usage:', usageError)
          // Don't fail the payment - just log the error
        } else {
          console.log('✅ Recorded discount usage for payment intent:', paymentIntent.id)
          }
        } else {
          console.log('ℹ️ Discount usage already recorded for payment intent:', paymentIntent.id)
        }
      }
    }
  }

  // Update payment record
  const { data: updatedPayment, error: paymentUpdateError } = await supabase
    .from('payments')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .select()

  if (paymentUpdateError) {
    console.error('❌ Webhook: Error updating payment record:', paymentUpdateError)
  } else if (updatedPayment && updatedPayment.length > 0) {
    console.log(`✅ Webhook: Updated payment record to completed: ${updatedPayment[0].id}`)
    
    // Update user_registrations record with payment_id
    const { error: registrationUpdateError } = await supabase
      .from('user_registrations')
      .update({ payment_id: updatedPayment[0].id })
      .eq('id', userRegistration.id)

    if (registrationUpdateError) {
      console.error('❌ Webhook: Error updating registration record with payment_id:', registrationUpdateError)
    } else {
      console.log(`✅ Webhook: Updated registration record with payment_id: ${updatedPayment[0].id}`)
    }
  } else {
    console.warn(`⚠️ Webhook: No payment record found for payment intent: ${paymentIntent.id}`)
  }

  // Xero integration is now handled entirely by the payment completion processor
  // This ensures consistent handling of staging records, emails, and batch sync

  // Trigger payment completion processor for emails and post-processing
  console.log('🔄 About to trigger payment completion processor for registration...')
  console.log('🔄 Registration webhook context:', {
    paymentIntentId: paymentIntent.id,
    userId,
    registrationId,
    userRegistrationId: userRegistration.id,
    updatedPaymentId: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
    amount: paymentIntent.amount
  })
  
  try {
    console.log('🔄 Registration payment completion processor parameters:', {
      event_type: 'user_registrations',
      record_id: userRegistration.id,
      user_id: userId,
      payment_id: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
      amount: paymentIntent.amount,
      trigger_source: 'stripe_webhook_registration'
    })
    
    console.log('🔄 Calling paymentProcessor.processPaymentCompletion for registration...')
    const processorResult = await paymentProcessor.processPaymentCompletion({
      event_type: 'user_registrations',
      record_id: userRegistration.id,
      user_id: userId,
      payment_id: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
      amount: paymentIntent.amount,
      trigger_source: 'stripe_webhook_registration',
      timestamp: new Date().toISOString()
    })
    console.log('✅ Registration payment completion processor returned successfully:', processorResult)
    console.log('✅ Triggered payment completion processor for registration')
  } catch (processorError) {
    console.error('❌ Failed to trigger payment completion processor for registration:', processorError)
    console.error('❌ Registration processor error details:', {
      message: processorError instanceof Error ? processorError.message : String(processorError),
      stack: processorError instanceof Error ? processorError.stack : undefined
    })
    // Don't fail the webhook - registration was processed successfully
  }

  console.log('Successfully processed registration payment intent:', paymentIntent.id)
}

export async function POST(request: NextRequest) {
  // Log webhook receipt immediately for debugging
  try {
    console.log('🔄 Webhook POST request received')
  } catch (logError) {
    console.error('❌ Failed to log webhook receipt:', logError)
  }

  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret)
    
    // Log webhook event immediately after signature verification
    console.log('🔄 Webhook event received:', {
      type: event.type,
      id: event.id,
      created: event.created,
      dataObjectId: event.data?.object && 'id' in event.data.object ? event.data.object.id : 'unknown'
    })
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  let supabase
  try {
    supabase = createAdminClient()
    console.log('✅ Database connection created successfully')
  } catch (dbError) {
    console.error('❌ Failed to create database connection:', dbError)
    return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
  }

  try {
    

    
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        
        // Debug: Log all metadata to see what we're receiving
        console.log('🔍 Payment intent metadata received:', {
          paymentIntentId: paymentIntent.id,
          amount: paymentIntent.amount,
          status: paymentIntent.status,
          allMetadata: paymentIntent.metadata
        })
        
        // Extract metadata
        const userId = paymentIntent.metadata.userId
        const membershipId = paymentIntent.metadata.membershipId
        const registrationId = paymentIntent.metadata.registrationId
        const durationMonths = paymentIntent.metadata.durationMonths ? parseInt(paymentIntent.metadata.durationMonths) : null

        // Handle membership payment
        if (userId && membershipId && durationMonths && !isNaN(durationMonths)) {
          await handleMembershipPayment(supabase, supabase, paymentIntent, userId, membershipId, durationMonths)
        }
        // Handle registration payment  
        else if (userId && registrationId) {
          await handleRegistrationPayment(supabase, paymentIntent, userId, registrationId)
        }
        else {
          console.error('❌ Missing required metadata in payment intent:', paymentIntent.id, {
            userId,
            membershipId,
            registrationId,
            durationMonths,
            hasDurationMonths: !!paymentIntent.metadata.durationMonths,
            allMetadataKeys: Object.keys(paymentIntent.metadata),
            allMetadata: paymentIntent.metadata
          })
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        
        // Update payment record
        await supabase
          .from('payments')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('stripe_payment_intent_id', paymentIntent.id)

        // Clean up draft invoice if it exists
        try {
          const invoiceNumber = paymentIntent.metadata.invoiceNumber
          const xeroInvoiceId = paymentIntent.metadata.xeroInvoiceId
          
          if (invoiceNumber && xeroInvoiceId) {
            console.log(`🗑️ Cleaning up draft invoice ${invoiceNumber} after payment failure`)
            
            // Delete the draft invoice from Xero
            const deleteResult = await deleteXeroDraftInvoice(xeroInvoiceId)
            
            if (deleteResult.success) {
              // Delete the draft invoice from our database
              await supabase
                .from('xero_invoices')
                .delete()
                .eq('xero_invoice_id', xeroInvoiceId)
                .eq('sync_status', 'pending') // Only delete if still pending
              
              console.log(`✅ Fully cleaned up draft invoice ${invoiceNumber} after payment failure`)
            } else {
              console.warn(`⚠️ Failed to delete invoice from Xero: ${deleteResult.error}`)
              // Still clean up our database tracking even if Xero deletion fails
              await supabase
                .from('xero_invoices')
                .delete()
                .eq('xero_invoice_id', xeroInvoiceId)
                .eq('sync_status', 'pending')
            }
          }
        } catch (cleanupError) {
          console.error('⚠️ Error cleaning up draft invoice after payment failure:', cleanupError)
          // Don't fail the webhook over cleanup issues
        }

        // Trigger payment completion processor for failed payment emails
        try {
          const userId = paymentIntent.metadata.userId
          const membershipId = paymentIntent.metadata.membershipId
          const registrationId = paymentIntent.metadata.registrationId

          if (userId) {
            const eventType = membershipId ? 'user_memberships' : (registrationId ? 'user_registrations' : null)
            
            if (eventType) {
              await paymentProcessor.processPaymentCompletion({
                event_type: eventType,
                record_id: null, // No record created for failed payment
                user_id: userId,
                payment_id: null, // No successful payment record
                amount: paymentIntent.amount,
                trigger_source: 'stripe_webhook_payment_failed',
                timestamp: new Date().toISOString(),
                metadata: {
                  payment_intent_id: paymentIntent.id,
                  failure_reason: paymentIntent.last_payment_error?.message || 'Unknown error',
                  failed: true
                }
              })
              console.log('✅ Triggered payment completion processor for failed payment')
            }
          }
        } catch (processorError) {
          console.error('❌ Failed to trigger payment completion processor for failed payment:', processorError)
          // Don't fail the webhook - payment failure was already recorded
        }

        console.log('Payment failed for payment intent:', paymentIntent.id)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Error processing webhook:', error)
    console.error('Webhook error details:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      eventType: event.type,
      paymentIntentId: event.data?.object && 'id' in event.data.object ? event.data.object.id : 'unknown'
    })
    
    // Report critical webhook error via Logger (automatically sends to Sentry)
    logger.logPaymentProcessing(
      'webhook-processing-error',
      'Critical webhook processing error',
      {
        eventType: event.type,
        paymentIntentId: event.data?.object && 'id' in event.data.object ? event.data.object.id : 'unknown',
        webhookBody: body.substring(0, 1000), // First 1000 chars for context
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      },
      'error'
    )
    
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}