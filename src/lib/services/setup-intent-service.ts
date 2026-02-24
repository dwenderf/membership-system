import Stripe from 'stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { userHasValidPaymentMethod } from '@/lib/services/payment-method-service'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
})

export interface SetupIntentResult {
  setupIntent: Stripe.SetupIntent
  clientSecret: string
}

export interface PaymentMethodInfo {
  id: string
  last4: string
  brand: string
  expMonth: number
  expYear: number
}

export class SetupIntentService {
  /**
   * Create a Setup Intent for saving payment methods without charging
   */
  static async createSetupIntent(userId: string): Promise<SetupIntentResult> {
    try {
      const supabase = await createClient()
      
      // Get user details for customer info
      const { data: userProfile, error: profileError } = await supabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', userId)
        .single()

      if (profileError || !userProfile) {
        throw new Error('User profile not found')
      }

      // Create Setup Intent
      const setupIntent = await stripe.setupIntents.create({
        customer: undefined, // We'll create customer on confirmation if needed
        payment_method_types: ['card'],
        usage: 'off_session', // For future payments
        metadata: {
          userId: userId,
          userName: `${userProfile.first_name} ${userProfile.last_name}`,
          userEmail: userProfile.email,
          purpose: 'alternate_registration'
        }
      })

      // Update user record with Setup Intent ID
      const adminSupabase = createAdminClient()
      const { error: updateError } = await adminSupabase
        .from('users')
        .update({
          stripe_setup_intent_id: setupIntent.id,
          setup_intent_status: 'pending',
          payment_method_updated_at: new Date().toISOString()
        })
        .eq('id', userId)

      if (updateError) {
        logger.logPaymentProcessing(
          'setup-intent-db-update-failed',
          'Failed to update user with Setup Intent ID',
          { 
            userId, 
            setupIntentId: setupIntent.id,
            error: updateError.message
          },
          'error'
        )
        // Don't fail the request, but log the issue
      }

      logger.logPaymentProcessing(
        'setup-intent-created',
        'Successfully created Setup Intent',
        { 
          userId, 
          setupIntentId: setupIntent.id,
          status: setupIntent.status
        },
        'info'
      )

      return {
        setupIntent,
        clientSecret: setupIntent.client_secret!
      }
    } catch (error) {
      logger.logPaymentProcessing(
        'setup-intent-creation-failed',
        'Failed to create Setup Intent',
        { 
          userId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      throw error
    }
  }

  /**
   * Confirm Setup Intent and save payment method
   */
  static async confirmSetupIntent(setupIntentId: string): Promise<PaymentMethodInfo> {
    try {
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
      
      if (setupIntent.status !== 'succeeded') {
        throw new Error(`Setup Intent not succeeded: ${setupIntent.status}`)
      }

      if (!setupIntent.payment_method) {
        throw new Error('No payment method attached to Setup Intent')
      }

      // Get payment method details
      const paymentMethod = await stripe.paymentMethods.retrieve(
        setupIntent.payment_method as string
      )

      if (!paymentMethod.card) {
        throw new Error('Payment method is not a card')
      }

      const userId = setupIntent.metadata?.userId
      if (!userId) {
        throw new Error('No user ID in Setup Intent metadata')
      }

      // Update user record with payment method
      const adminSupabase = createAdminClient()
      const { error: updateError } = await adminSupabase
        .from('users')
        .update({
          stripe_payment_method_id: paymentMethod.id,
          setup_intent_status: 'succeeded',
          payment_method_updated_at: new Date().toISOString()
        })
        .eq('id', userId)

      if (updateError) {
        logger.logPaymentProcessing(
          'payment-method-db-update-failed',
          'Failed to update user with payment method',
          { 
            userId, 
            paymentMethodId: paymentMethod.id,
            error: updateError.message
          },
          'error'
        )
        throw updateError
      }

      logger.logPaymentProcessing(
        'setup-intent-confirmed',
        'Successfully confirmed Setup Intent and saved payment method',
        { 
          userId, 
          setupIntentId,
          paymentMethodId: paymentMethod.id,
          last4: paymentMethod.card.last4
        },
        'info'
      )

      return {
        id: paymentMethod.id,
        last4: paymentMethod.card.last4,
        brand: paymentMethod.card.brand,
        expMonth: paymentMethod.card.exp_month,
        expYear: paymentMethod.card.exp_year
      }
    } catch (error) {
      logger.logPaymentProcessing(
        'setup-intent-confirmation-failed',
        'Failed to confirm Setup Intent',
        { 
          setupIntentId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      throw error
    }
  }

  /**
   * Detach payment method from Stripe and remove from user
   */
  static async detachPaymentMethod(paymentMethodId: string, userId: string): Promise<void> {
    try {
      // Detach from Stripe
      await stripe.paymentMethods.detach(paymentMethodId)

      // Update user record
      const adminSupabase = createAdminClient()
      const { error: updateError } = await adminSupabase
        .from('users')
        .update({
          stripe_payment_method_id: null,
          stripe_setup_intent_id: null,
          setup_intent_status: null,
          payment_method_updated_at: new Date().toISOString()
        })
        .eq('id', userId)

      if (updateError) {
        logger.logPaymentProcessing(
          'payment-method-removal-db-failed',
          'Failed to update user after payment method removal',
          { 
            userId, 
            paymentMethodId,
            error: updateError.message
          },
          'error'
        )
        throw updateError
      }

      // Remove user from all alternate registrations
      const { error: alternateRemovalError } = await adminSupabase
        .from('user_alternate_registrations')
        .delete()
        .eq('user_id', userId)

      if (alternateRemovalError) {
        logger.logPaymentProcessing(
          'alternate-registrations-removal-failed',
          'Failed to remove user from alternate registrations',
          { 
            userId, 
            paymentMethodId,
            error: alternateRemovalError.message
          },
          'error'
        )
        // Don't fail the whole operation, but log the issue
      }

      logger.logPaymentProcessing(
        'payment-method-detached',
        'Successfully detached payment method and cleaned up user data',
        { 
          userId, 
          paymentMethodId
        },
        'info'
      )
    } catch (error) {
      logger.logPaymentProcessing(
        'payment-method-detach-failed',
        'Failed to detach payment method',
        { 
          userId,
          paymentMethodId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      throw error
    }
  }

  /**
   * Get user's saved payment method info
   */
  static async getUserPaymentMethod(userId: string): Promise<PaymentMethodInfo | null> {
    try {
      const supabase = await createClient()
      
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('stripe_payment_method_id, setup_intent_status')
        .eq('id', userId)
        .single()

      if (userError || !user || !userHasValidPaymentMethod(user)) {
        return null
      }

      // Get payment method from Stripe
      const paymentMethod = await stripe.paymentMethods.retrieve(user.stripe_payment_method_id)
      
      if (!paymentMethod.card) {
        return null
      }

      return {
        id: paymentMethod.id,
        last4: paymentMethod.card.last4,
        brand: paymentMethod.card.brand,
        expMonth: paymentMethod.card.exp_month,
        expYear: paymentMethod.card.exp_year
      }
    } catch (error) {
      logger.logPaymentProcessing(
        'get-payment-method-failed',
        'Failed to get user payment method',
        { 
          userId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return null
    }
  }

  /**
   * Check if user has a valid payment method set up
   */
  static async hasValidPaymentMethod(userId: string): Promise<boolean> {
    const paymentMethod = await this.getUserPaymentMethod(userId)
    return paymentMethod !== null
  }
}