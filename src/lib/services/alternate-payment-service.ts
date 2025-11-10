import Stripe from 'stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { xeroStagingManager, StagingPaymentData } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'
import { PaymentCompletionProcessor } from '@/lib/payment-completion-processor'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
})

export interface AlternateChargeResult {
  paymentId: string
  amountCharged: number
  success: boolean
}

export class AlternatePaymentService {
  /**
   * Charge an alternate for a specific game
   */
  static async chargeAlternate(
    userId: string,
    registrationId: string,
    gameDescription: string,
    gameId: string,
    discountCodeId?: string
  ): Promise<AlternateChargeResult> {
    try {
      const supabase = await createClient()
      const adminSupabase = createAdminClient()

      // Get user's payment method and customer
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('stripe_payment_method_id, setup_intent_status, email, first_name, last_name, stripe_customer_id')
        .eq('id', userId)
        .single()

      if (userError || !user) {
        throw new Error('User not found')
      }

      if (!user.stripe_payment_method_id || user.setup_intent_status !== 'succeeded') {
        throw new Error('User does not have a valid payment method')
      }

      if (!user.stripe_customer_id) {
        throw new Error('User does not have a Stripe customer ID')
      }

      // Get registration details for pricing
      const { data: registration, error: registrationError } = await supabase
        .from('registrations')
        .select('name, alternate_price, alternate_accounting_code')
        .eq('id', registrationId)
        .single()

      if (registrationError || !registration) {
        throw new Error('Registration not found')
      }

      if (!registration.alternate_price || !registration.alternate_accounting_code) {
        throw new Error('Registration does not have alternate pricing configured')
      }

      // Calculate charge amount
      const { finalAmount, discountAmount, discountCode } = await this.calculateChargeAmount(
        registrationId,
        discountCodeId,
        userId
      )

      // Create staging record for Xero
      const stagingData: StagingPaymentData = {
        user_id: userId,
        total_amount: centsToCents(registration.alternate_price),
        discount_amount: centsToCents(discountAmount),
        final_amount: centsToCents(finalAmount),
        payment_items: [
          {
            item_type: 'registration' as const,
            item_id: registrationId,
            item_amount: centsToCents(registration.alternate_price),
            description: `Alternate: ${registration.name} - ${gameDescription}`,
            accounting_code: registration.alternate_accounting_code
          }
        ],
        discount_codes_used: discountCode ? [discountCode] : [],
        stripe_payment_intent_id: null // Will be updated after payment
      }

      // Add discount line item if applicable
      if (discountAmount > 0 && discountCode) {
        if (!discountCode.category?.accounting_code) {
          const error = new Error(`Discount code ${discountCode.code} has no accounting code configured`)
          logger.logPaymentProcessing(
            'discount-accounting-code-missing',
            'Critical: Discount code missing accounting code',
            {
              discountCodeId: discountCode.id,
              discountCode: discountCode.code,
              categoryId: discountCode.category?.id,
              userId,
              registrationId,
              gameDescription
            },
            'error'
          )
          // Report to Sentry
          const { captureException } = await import('@sentry/nextjs')
          captureException(error, {
            extra: {
              discountCodeId: discountCode.id,
              discountCode: discountCode.code,
              categoryId: discountCode.category?.id,
              userId,
              registrationId
            }
          })
          throw error
        }

        stagingData.payment_items.push({
          item_type: 'discount' as const,
          item_id: null,
          item_amount: centsToCents(-discountAmount),
          description: `Discount: ${discountCode.code} - ${gameDescription}`,
          accounting_code: discountCode.category.accounting_code
        })
      }

      const stagingRecord = await xeroStagingManager.createImmediateStaging(stagingData, { isFree: finalAmount === 0 })

      if (!stagingRecord) {
        throw new Error('Failed to create Xero staging record')
      }

      // Handle free charge (after discount)
      if (finalAmount === 0) {
        logger.logPaymentProcessing(
          'free-alternate-charge-processing',
          'Processing free alternate charge (no Stripe payment needed)',
          {
            userId,
            registrationId,
            gameDescription,
            gameId,
            basePrice: registration.alternate_price,
            discountAmount,
            finalAmount: 0
          },
          'info'
        )
        
        return await this.handleFreeAlternateCharge(
          userId,
          registrationId,
          gameDescription,
          stagingRecord,
          discountCodeId
        )
      }

      // Create Payment Intent for the charge
      const paymentIntent = await stripe.paymentIntents.create({
        amount: centsToCents(finalAmount),
        currency: 'usd',
        payment_method: user.stripe_payment_method_id,
        customer: user.stripe_customer_id, // Use the stored customer ID
        confirm: true, // Immediately attempt to charge
        off_session: true, // This is an off-session payment
        receipt_email: user.email,
        metadata: {
          userId: userId,
          registrationId: registrationId,
          gameId: gameId,
          gameDescription: gameDescription,
          userName: `${user.first_name} ${user.last_name}`,
          purpose: 'alternate_selection',
          xeroStagingRecordId: stagingRecord.id, // Direct link to xero_invoices staging table
          ...(discountCodeId && { discountCodeId })
        },
        description: `Alternate Selection: ${registration.name} - ${gameDescription}`
      })

      // Update staging record with payment intent ID
      const currentMetadata = stagingRecord.staging_metadata || {}
      const updatedMetadata = {
        ...currentMetadata,
        stripe_payment_intent_id: paymentIntent.id
      }

      await adminSupabase
        .from('xero_invoices')
        .update({ staging_metadata: updatedMetadata })
        .eq('id', stagingRecord.id)

      // Create payment record
      const { data: paymentRecord, error: paymentError } = await supabase
        .from('payments')
        .insert({
          user_id: userId,
          total_amount: centsToCents(finalAmount),
          final_amount: centsToCents(finalAmount),
          stripe_payment_intent_id: paymentIntent.id,
          status: paymentIntent.status === 'succeeded' ? 'completed' : 'pending',
          payment_method: 'stripe',
          completed_at: paymentIntent.status === 'succeeded' ? new Date().toISOString() : null
        })
        .select()
        .single()

      if (paymentError) {
        throw new Error(`Failed to create payment record: ${paymentError.message}`)
      }

      // Link payment to staging records
      await adminSupabase
        .from('xero_invoices')
        .update({ payment_id: paymentRecord.id })
        .eq('id', stagingRecord.id)

      // Record discount usage if applicable
      if (discountCodeId && discountAmount > 0) {
        await this.recordDiscountUsage(userId, discountCodeId, registrationId, discountAmount)
      }

      logger.logPaymentProcessing(
        'alternate-charge-success',
        'Successfully charged alternate',
        {
          userId,
          registrationId,
          gameDescription,
          paymentIntentId: paymentIntent.id,
          amountCharged: finalAmount,
          discountAmount
        },
        'info'
      )

      return {
        paymentId: paymentRecord.id,
        amountCharged: finalAmount,
        success: paymentIntent.status === 'succeeded'
      }
    } catch (error) {
      logger.logPaymentProcessing(
        'alternate-charge-failed',
        'Failed to charge alternate',
        {
          userId,
          registrationId,
          gameDescription,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      throw error
    }
  }

  /**
   * Calculate the final charge amount after applying discounts
   */
  static async calculateChargeAmount(
    registrationId: string,
    discountCodeId?: string,
    userId?: string
  ): Promise<{ finalAmount: number; discountAmount: number; discountCode?: any }> {
    try {
      const supabase = await createClient()

      // Get registration pricing
      const { data: registration, error: registrationError } = await supabase
        .from('registrations')
        .select('alternate_price')
        .eq('id', registrationId)
        .single()

      if (registrationError || !registration) {
        throw new Error('Registration not found')
      }

      const basePrice = registration.alternate_price || 0
      let discountAmount = 0
      let discountCode = null

      if (discountCodeId && userId) {
        // Get discount code details
        const { data: discount, error: discountError } = await supabase
          .from('discount_codes')
          .select(`
            *,
            category:discount_categories(*)
          `)
          .eq('id', discountCodeId)
          .single()

        if (!discountError && discount) {
          discountCode = discount

          // Calculate discount amount (all discounts are percentage-based)
          discountAmount = Math.round((basePrice * discount.percentage) / 100)

          // Check usage limits
          if (discount.usage_limit && discount.usage_limit > 0) {
            const { data: usageCount } = await supabase
              .from('discount_usage')
              .select('id')
              .eq('user_id', userId)
              .eq('discount_code_id', discountCodeId)

            const currentUsage = usageCount?.length || 0

            if (currentUsage >= discount.usage_limit) {
              // User has exceeded limit - no discount
              discountAmount = 0
            } else {
              // Calculate remaining discount amount if partially used
              const remainingUses = discount.usage_limit - currentUsage
              if (remainingUses <= 0) {
                discountAmount = 0
              }
            }
          }
        }
      }

      const finalAmount = Math.max(0, basePrice - discountAmount)

      return {
        finalAmount,
        discountAmount,
        discountCode
      }
    } catch (error) {
      logger.logPaymentProcessing(
        'calculate-charge-amount-failed',
        'Failed to calculate charge amount',
        {
          registrationId,
          discountCodeId,
          userId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      throw error
    }
  }

  /**
   * Handle free alternate charge (after discount makes it $0)
   */
  private static async handleFreeAlternateCharge(
    userId: string,
    registrationId: string,
    gameDescription: string,
    stagingRecord: any,
    discountCodeId?: string
  ): Promise<AlternateChargeResult> {
    try {
      const supabase = await createClient()
      const adminSupabase = createAdminClient()

      // Create payment record with $0 amount
      const { data: paymentRecord, error: paymentError } = await supabase
        .from('payments')
        .insert({
          user_id: userId,
          total_amount: 0,
          final_amount: 0,
          stripe_payment_intent_id: null,
          status: 'completed',
          payment_method: 'free',
          completed_at: new Date().toISOString()
        })
        .select()
        .single()

      if (paymentError) {
        throw new Error(`Failed to create payment record: ${paymentError.message}`)
      }

      // Link payment to staging records
      await adminSupabase
        .from('xero_invoices')
        .update({ payment_id: paymentRecord.id })
        .eq('id', stagingRecord.id)

      // Record discount usage if applicable
      if (discountCodeId) {
        const { data: registration } = await supabase
          .from('registrations')
          .select('alternate_price')
          .eq('id', registrationId)
          .single()

        const discountAmount = registration?.alternate_price || 0
        await this.recordDiscountUsage(userId, discountCodeId, registrationId, discountAmount)
      }

      // Trigger post-payment processing (emails, Xero sync)
      try {
        const paymentProcessor = new PaymentCompletionProcessor()
        await paymentProcessor.processPaymentCompletion({
          event_type: 'alternate_selections',
          record_id: registrationId,
          user_id: userId,
          payment_id: paymentRecord.id,
          amount: 0,
          trigger_source: 'free_alternate',
          timestamp: new Date().toISOString(),
          metadata: {
            xero_staging_record_id: stagingRecord.id
          }
        })
      } catch (error) {
        // Log error but don't fail the payment - emails/Xero can be handled manually if needed
        logger.logPaymentProcessing(
          'free-alternate-post-payment-processing-failed',
          'Failed to process post-payment actions for free alternate charge',
          {
            userId,
            registrationId,
            gameDescription,
            paymentId: paymentRecord.id,
            error: error instanceof Error ? error.message : String(error)
          },
          'error'
        )
      }

      logger.logPaymentProcessing(
        'free-alternate-charge-success',
        'Successfully processed free alternate charge',
        {
          userId,
          registrationId,
          gameDescription,
          paymentId: paymentRecord.id
        },
        'info'
      )

      return {
        paymentId: paymentRecord.id,
        amountCharged: 0,
        success: true
      }
    } catch (error) {
      logger.logPaymentProcessing(
        'free-alternate-charge-failed',
        'Failed to process free alternate charge',
        {
          userId,
          registrationId,
          gameDescription,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      throw error
    }
  }

  /**
   * Record discount code usage
   */
  private static async recordDiscountUsage(
    userId: string,
    discountCodeId: string,
    registrationId: string,
    amountSaved: number
  ): Promise<void> {
    try {
      const supabase = await createClient()

      // Get discount code and registration details
      const [discountResult, registrationResult] = await Promise.all([
        supabase
          .from('discount_codes')
          .select('discount_category_id')
          .eq('id', discountCodeId)
          .single(),
        supabase
          .from('registrations')
          .select('season_id')
          .eq('id', registrationId)
          .single()
      ])

      if (discountResult.error || registrationResult.error) {
        throw new Error('Failed to get discount or registration details')
      }

      // Record discount usage for this alternate purchase
      // No duplicate check - each alternate purchase is unique even for same registration
      const { error: insertError } = await supabase
        .from('discount_usage')
        .insert({
          user_id: userId,
          discount_code_id: discountCodeId,
          discount_category_id: discountResult.data.discount_category_id,
          season_id: registrationResult.data.season_id,
          amount_saved: amountSaved,
          registration_id: registrationId
        })

      if (insertError) {
        throw new Error(`Failed to record discount usage: ${insertError.message}`)
      }
    } catch (error) {
      logger.logPaymentProcessing(
        'discount-usage-recording-failed',
        'Failed to record discount usage',
        {
          userId,
          discountCodeId,
          registrationId,
          amountSaved,
          error: error instanceof Error ? error.message : String(error)
        },
        'warn'
      )
      // Don't throw - this is not critical for the payment flow
    }
  }
}