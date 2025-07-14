import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { emailService } from '@/lib/email-service'
import { autoSyncPaymentToXero } from '@/lib/xero-auto-sync'
import { deleteXeroDraftInvoice } from '@/lib/xero-invoices'
import { paymentProcessor } from '@/lib/payment-completion-processor'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
})

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!

// Handle membership payment processing
async function handleMembershipPayment(supabase: any, paymentIntent: Stripe.PaymentIntent, userId: string, membershipId: string, durationMonths: number) {
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

  // Create user membership record
  const { data: membershipRecord, error: membershipError } = await supabase
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

  if (membershipError || !membershipRecord) {
    console.error('Error creating user membership:', membershipError)
    throw new Error('Failed to create membership')
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
  } else {
    console.warn(`⚠️ Webhook: No membership payment record found for payment intent: ${paymentIntent.id}`)
  }

  // Send confirmation email (as backup to confirm-payment endpoint)
  try {
    const { data: userProfile } = await supabase
      .from('users')
      .select('first_name, last_name, email')
      .eq('id', userId)
      .single()

    const { data: membershipDetails } = await supabase
      .from('memberships')
      .select('name')
      .eq('id', membershipId)
      .single()

    if (userProfile && membershipDetails) {
      await emailService.sendMembershipPurchaseConfirmation({
        userId: userId,
        email: userProfile.email,
        userName: `${userProfile.first_name} ${userProfile.last_name}`,
        membershipName: membershipDetails.name,
        amount: paymentIntent.amount,
        durationMonths,
        validFrom: startDate.toISOString().split('T')[0],
        validUntil: endDate.toISOString().split('T')[0],
        paymentIntentId: paymentIntent.id
      })
      console.log('✅ Webhook: Membership confirmation email sent successfully')
    }
  } catch (emailError) {
    console.error('❌ Webhook: Failed to send confirmation email:', emailError)
    // Don't fail the webhook - membership was created successfully
  }

  // Handle Xero integration
  try {
    const { data: paymentRecord } = await supabase
      .from('payments')
      .select('id')
      .eq('stripe_payment_intent_id', paymentIntent.id)
      .single()
    
    if (paymentRecord) {
      // Check if invoice was already created (new invoice-first flow)
      const invoiceNumber = paymentIntent.metadata.invoiceNumber
      const xeroInvoiceId = paymentIntent.metadata.xeroInvoiceId
      
      if (invoiceNumber && xeroInvoiceId) {
        console.log(`✅ Found existing Xero invoice ${invoiceNumber} for payment, updating status...`)
        
        // Update existing invoice status and sync status
        await supabase
          .from('xero_invoices')
          .update({ 
            sync_status: 'synced',
            last_synced_at: new Date().toISOString()
          })
          .eq('xero_invoice_id', xeroInvoiceId)
          .eq('payment_id', paymentRecord.id)

        // TODO: Update invoice status in Xero from DRAFT to AUTHORISED
        // This will require a separate API call to update the invoice in Xero
        
        console.log(`✅ Updated Xero invoice ${invoiceNumber} status after payment completion`)
      } else {
        console.log('⚠️ No invoice metadata found, falling back to old flow')
        // Fall back to old flow (create invoice after payment)
        await autoSyncPaymentToXero(paymentRecord.id)
      }
    }
  } catch (xeroError) {
    console.error('❌ Webhook: Failed to sync membership payment to Xero:', xeroError)
    // Don't fail the webhook - membership was created successfully
  }

  // Trigger payment completion processor for emails and post-processing
  try {
    await paymentProcessor.processPaymentCompletion({
      event_type: 'user_memberships',
      record_id: membershipRecord.id,
      user_id: userId,
      payment_id: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
      amount: paymentIntent.amount,
      trigger_source: 'stripe_webhook_membership',
      timestamp: new Date().toISOString()
    })
    console.log('✅ Triggered payment completion processor for membership')
  } catch (processorError) {
    console.error('❌ Failed to trigger payment completion processor for membership:', processorError)
    // Don't fail the webhook - membership was created successfully
  }

  console.log('Successfully processed membership payment intent:', paymentIntent.id)
}

// Handle registration payment processing
async function handleRegistrationPayment(supabase: any, paymentIntent: Stripe.PaymentIntent, userId: string, registrationId: string) {
  // Note: Webhook doesn't have access to categoryId, so we'll need to get it from the registration
  // For now, let's keep the direct database update in webhooks since they're backup/redundancy
  
  // Update user registration record from awaiting_payment/processing to paid
  const { data: userRegistration, error: registrationError } = await supabase
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

  if (registrationError || !userRegistration) {
    console.error('Error updating user registration:', registrationError)
    throw new Error('Failed to update registration')
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
        // Record discount usage
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
  } else {
    console.warn(`⚠️ Webhook: No payment record found for payment intent: ${paymentIntent.id}`)
  }

  // Send registration confirmation email
  try {
    const { data: userProfile } = await supabase
      .from('users')
      .select('first_name, last_name, email')
      .eq('id', userId)
      .single()

    const { data: registrationDetails } = await supabase
      .from('registrations')
      .select(`
        name,
        type,
        season:seasons(name),
        registration_categories!inner(
          custom_name,
          category:categories(name)
        )
      `)
      .eq('id', registrationId)
      .eq('registration_categories.id', userRegistration.registration_category_id)
      .single()

    if (userProfile && registrationDetails) {
      const categoryName = registrationDetails.registration_categories.category?.name || 
                          registrationDetails.registration_categories.custom_name || 
                          'Registration'

      await emailService.sendEmail({
        userId: userId,
        email: userProfile.email,
        eventType: 'registration.confirmed',
        subject: `Registration Confirmed - ${registrationDetails.name}`,
        triggeredBy: 'automated',
        data: {
          userName: `${userProfile.first_name} ${userProfile.last_name}`,
          registrationName: registrationDetails.name,
          categoryName: categoryName,
          seasonName: registrationDetails.season?.name || '',
          originalAmount: parseInt(paymentIntent.metadata.originalAmount || '0'),
          discountAmount: discountAmount,
          finalAmount: paymentIntent.amount,
          discountCode: discountCode || null,
          registrationType: registrationDetails.type,
          paymentIntentId: paymentIntent.id
        }
      })
      console.log('✅ Webhook: Registration confirmation email sent successfully')
    }
  } catch (emailError) {
    console.error('❌ Webhook: Failed to send registration confirmation email:', emailError)
    // Don't fail the webhook - registration was processed successfully
  }

  // Handle Xero integration
  try {
    const { data: paymentRecord } = await supabase
      .from('payments')
      .select('id')
      .eq('stripe_payment_intent_id', paymentIntent.id)
      .single()
    
    if (paymentRecord) {
      // Check if invoice was already created (new invoice-first flow)
      const invoiceNumber = paymentIntent.metadata.invoiceNumber
      const xeroInvoiceId = paymentIntent.metadata.xeroInvoiceId
      
      if (invoiceNumber && xeroInvoiceId) {
        console.log(`✅ Found existing Xero invoice ${invoiceNumber} for registration payment, updating status...`)
        
        // Update existing invoice status and sync status
        await supabase
          .from('xero_invoices')
          .update({ 
            sync_status: 'synced',
            last_synced_at: new Date().toISOString()
          })
          .eq('xero_invoice_id', xeroInvoiceId)
          .eq('payment_id', paymentRecord.id)

        // TODO: Update invoice status in Xero from DRAFT to AUTHORISED
        // This will require a separate API call to update the invoice in Xero
        
        console.log(`✅ Updated Xero invoice ${invoiceNumber} status after registration payment completion`)
      } else {
        console.log('⚠️ No invoice metadata found, falling back to old flow')
        // Fall back to old flow (create invoice after payment)
        await autoSyncPaymentToXero(paymentRecord.id)
      }
    }
  } catch (xeroError) {
    console.error('❌ Webhook: Failed to sync registration payment to Xero:', xeroError)
    // Don't fail the webhook - registration was processed successfully
  }

  // Trigger payment completion processor for emails and post-processing
  try {
    await paymentProcessor.processPaymentCompletion({
      event_type: 'user_registrations',
      record_id: userRegistration.id,
      user_id: userId,
      payment_id: updatedPayment && updatedPayment.length > 0 ? updatedPayment[0].id : null,
      amount: paymentIntent.amount,
      trigger_source: 'stripe_webhook_registration',
      timestamp: new Date().toISOString()
    })
    console.log('✅ Triggered payment completion processor for registration')
  } catch (processorError) {
    console.error('❌ Failed to trigger payment completion processor for registration:', processorError)
    // Don't fail the webhook - registration was processed successfully
  }

  console.log('Successfully processed registration payment intent:', paymentIntent.id)
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  const supabase = createClient()

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        
        // Extract metadata
        const userId = paymentIntent.metadata.userId
        const membershipId = paymentIntent.metadata.membershipId
        const registrationId = paymentIntent.metadata.registrationId
        const durationMonths = parseInt(paymentIntent.metadata.durationMonths)

        // Handle membership payment
        if (userId && membershipId && durationMonths) {
          await handleMembershipPayment(supabase, paymentIntent, userId, membershipId, durationMonths)
        }
        // Handle registration payment  
        else if (userId && registrationId) {
          await handleRegistrationPayment(supabase, paymentIntent, userId, registrationId)
        }
        else {
          console.error('Missing required metadata in payment intent:', paymentIntent.id)
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
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}