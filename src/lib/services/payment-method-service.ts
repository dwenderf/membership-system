import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
})

/**
 * Save payment method from a completed payment intent to user profile
 * This is called after successful payment when user opted to save their payment method
 */
export async function savePaymentMethodFromIntent(
  paymentIntent: Stripe.PaymentIntent,
  userId: string,
  supabase: any
): Promise<void> {
  if (!paymentIntent.payment_method || !paymentIntent.setup_future_usage) {
    return
  }

  try {
    console.log('💳 Saving payment method for future use:', paymentIntent.payment_method)
    const adminSupabase = createAdminClient()

    // Get user profile to check for Stripe customer ID
    const { data: userProfile } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single()

    let customerId = userProfile?.stripe_customer_id

    // If no customer ID exists, retrieve it from the payment intent or create one
    if (!customerId && paymentIntent.customer) {
      customerId = paymentIntent.customer as string

      // Update user with customer ID
      await adminSupabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId)
    }

    if (customerId) {
      // Attach payment method to customer if not already attached
      const paymentMethod = await stripe.paymentMethods.retrieve(
        paymentIntent.payment_method as string
      )

      if (paymentMethod.customer !== customerId) {
        await stripe.paymentMethods.attach(
          paymentIntent.payment_method as string,
          { customer: customerId }
        )
      }

      // Save payment method ID to user profile
      await adminSupabase
        .from('users')
        .update({
          stripe_payment_method_id: paymentIntent.payment_method as string,
          payment_method_updated_at: new Date().toISOString()
        })
        .eq('id', userId)

      logger.logPaymentProcessing(
        'payment-method-saved',
        'Successfully saved payment method for user',
        {
          userId,
          paymentIntentId: paymentIntent.id,
          paymentMethodId: paymentIntent.payment_method as string
        },
        'info'
      )

      console.log('✅ Successfully saved payment method for user')
    }
  } catch (pmError) {
    logger.logPaymentProcessing(
      'payment-method-save-error',
      'Error saving payment method',
      {
        userId,
        paymentIntentId: paymentIntent.id,
        error: pmError instanceof Error ? pmError.message : String(pmError)
      },
      'error'
    )
    console.error('Error saving payment method:', pmError)
    // Don't throw - this is a non-critical failure
  }
}
