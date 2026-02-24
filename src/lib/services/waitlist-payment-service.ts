import Stripe from 'stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { xeroStagingManager, StagingPaymentData } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'
import { PaymentCompletionProcessor } from '@/lib/payment-completion-processor'
import { checkSeasonalDiscountLimit } from '@/lib/services/discount-limit-service'
import { userHasValidPaymentMethod } from '@/lib/payment-method-utils'
import { SupabaseClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
})

export interface WaitlistChargeResult {
  paymentId: string
  amountCharged: number
  success: boolean
  paymentIntentId?: string
}

export class WaitlistPaymentService {
  /**
   * Charge a waitlist user for registration
   */
  static async chargeWaitlistUser(
    userId: string,
    registrationId: string,
    categoryId: string,
    categoryName: string,
    discountCodeId?: string,
    overridePrice?: number
  ): Promise<WaitlistChargeResult> {
    try {
      const supabase = await createClient()
      const adminSupabase = createAdminClient()

      // Get user details
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('stripe_payment_method_id, setup_intent_status, email, first_name, last_name, stripe_customer_id')
        .eq('id', userId)
        .single()

      if (userError || !user) {
        throw new Error('User not found')
      }

      // Payment method validation will be done later, only if payment is actually required

      // Get registration details
      const { data: registration, error: registrationError } = await supabase
        .from('registrations')
        .select('name, season_id')
        .eq('id', registrationId)
        .single()

      if (registrationError || !registration) {
        throw new Error('Registration not found')
      }

      // Get category details for pricing
      const { data: category, error: categoryError } = await supabase
        .from('registration_categories')
        .select('price, accounting_code')
        .eq('id', categoryId)
        .single()

      if (categoryError || !category) {
        throw new Error('Registration category not found')
      }

      if (!category.price || !category.accounting_code) {
        throw new Error('Registration category does not have pricing configured')
      }

      // Validate override price if provided
      if (overridePrice !== undefined) {
        if (overridePrice < 0 || overridePrice > category.price) {
          throw new Error(`Override price must be between 0 and ${category.price}`)
        }
      }

      // Calculate effective base price and discount
      let effectiveBasePrice: number
      let finalAmount: number
      let discountAmount: number
      let discountCode: any = null

      if (overridePrice !== undefined) {
        // Override price: use override as new base, then apply discount
        effectiveBasePrice = overridePrice

        // Calculate discount on the new base price
        if (discountCodeId) {
          const calculated = await this.calculateChargeAmount(
            adminSupabase,
            categoryId,
            registration.season_id,
            discountCodeId,
            userId
          )
          discountCode = calculated.discountCode

          if (discountCode) {
            // Apply the same discount percentage to the new base price
            let requestedDiscountAmount = Math.round((effectiveBasePrice * discountCode.percentage) / 100)

            // Enforce seasonal discount cap
            if (requestedDiscountAmount > 0) {
              const limitResult = await checkSeasonalDiscountLimit(
                adminSupabase,
                userId!,
                discountCodeId,
                registration.season_id,
                requestedDiscountAmount
              )

              discountAmount = limitResult.finalAmount

              // Log if partial discount was applied
              if (limitResult.isPartialDiscount) {
                logger.logPaymentProcessing(
                  'waitlist-override-partial-discount-applied',
                  'Applied partial discount due to seasonal limit (override price flow)',
                  {
                    userId,
                    registrationId,
                    categoryId,
                    discountCodeId,
                    overridePrice,
                    requestedAmount: requestedDiscountAmount,
                    appliedAmount: discountAmount,
                    seasonalUsage: limitResult.seasonalUsage
                  },
                  'info'
                )
              }
            } else {
              discountAmount = requestedDiscountAmount
            }

            finalAmount = effectiveBasePrice - discountAmount
          } else {
            discountAmount = 0
            finalAmount = effectiveBasePrice
          }
        } else {
          discountAmount = 0
          finalAmount = effectiveBasePrice
        }
      } else {
        // Normal flow: use category price as base and calculate with discount codes
        effectiveBasePrice = category.price
        const calculated = await this.calculateChargeAmount(
          adminSupabase,
          categoryId,
          registration.season_id,
          discountCodeId,
          userId
        )
        finalAmount = calculated.finalAmount
        discountAmount = calculated.discountAmount
        discountCode = calculated.discountCode
      }

      // Create staging record for Xero
      const stagingData: StagingPaymentData = {
        user_id: userId,
        total_amount: centsToCents(effectiveBasePrice),
        discount_amount: centsToCents(discountAmount),
        final_amount: centsToCents(finalAmount),
        payment_items: [
          {
            item_type: 'registration' as const,
            item_id: registrationId,
            item_amount: centsToCents(effectiveBasePrice),
            description: `Waitlist: ${registration.name} - ${categoryName}`,
            accounting_code: category.accounting_code
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
              categoryName
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
          description: `Discount: ${discountCode.code} - ${categoryName}`,
          accounting_code: discountCode.category.accounting_code,
          discount_code_id: discountCode.id
        })
      }

      const stagingRecord = await xeroStagingManager.createImmediateStaging(stagingData, { isFree: finalAmount === 0 })

      if (!stagingRecord) {
        throw new Error('Failed to create Xero staging record')
      }

      // Handle free charge (after discount)
      if (finalAmount === 0) {
        logger.logPaymentProcessing(
          'free-waitlist-charge-processing',
          'Processing free waitlist charge (no Stripe payment needed)',
          {
            userId,
            registrationId,
            categoryId,
            categoryName,
            basePrice: category.price,
            discountAmount,
            finalAmount: 0
          },
          'info'
        )

        return await this.handleFreeWaitlistCharge(
          userId,
          registrationId,
          categoryId,
          categoryName,
          stagingRecord,
          discountCodeId
        )
      }

      // Validate payment method (only required for paid charges)
      if (!userHasValidPaymentMethod(user)) {
        throw new Error('User does not have a valid payment method')
      }

      if (!user.stripe_customer_id) {
        throw new Error('User does not have a Stripe customer ID')
      }

      // Create Payment Intent for the charge
      const paymentIntent = await stripe.paymentIntents.create({
        amount: centsToCents(finalAmount),
        currency: 'usd',
        payment_method: user.stripe_payment_method_id,
        customer: user.stripe_customer_id,
        confirm: true, // Immediately attempt to charge
        off_session: true, // This is an off-session payment
        receipt_email: user.email,
        metadata: {
          userId: userId,
          registrationId: registrationId,
          categoryId: categoryId,
          categoryName: categoryName,
          userName: `${user.first_name} ${user.last_name}`,
          purpose: 'waitlist_selection',
          xeroStagingRecordId: stagingRecord.id, // Direct link to xero_invoices staging table
          ...(discountCodeId && { discountCodeId })
        },
        description: `Waitlist Selection: ${registration.name} - ${categoryName}`
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

      // Note: Discount usage is now tracked via discount_usage_computed view
      // which derives data from xero_invoice_line_items

      logger.logPaymentProcessing(
        'waitlist-charge-success',
        'Successfully charged waitlist user',
        {
          userId,
          registrationId,
          categoryId,
          categoryName,
          paymentIntentId: paymentIntent.id,
          amountCharged: finalAmount,
          discountAmount
        },
        'info'
      )

      return {
        paymentId: paymentRecord.id,
        amountCharged: finalAmount,
        success: paymentIntent.status === 'succeeded',
        paymentIntentId: paymentIntent.id
      }
    } catch (error) {
      logger.logPaymentProcessing(
        'waitlist-charge-failed',
        'Failed to charge waitlist user',
        {
          userId,
          registrationId,
          categoryId,
          categoryName,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      throw error
    }
  }

  /**
   * Calculate the final charge amount after applying discounts
   * Enforces both per-code usage limits and seasonal discount caps
   */
  static async calculateChargeAmount(
    supabase: SupabaseClient,
    categoryId: string,
    seasonId: string,
    discountCodeId?: string,
    userId?: string
  ): Promise<{ finalAmount: number; discountAmount: number; discountCode?: any }> {
    try {
      // Get category pricing
      const { data: category, error: categoryError } = await supabase
        .from('registration_categories')
        .select('price')
        .eq('id', categoryId)
        .single()

      if (categoryError || !category) {
        throw new Error('Registration category not found')
      }

      const basePrice = category.price || 0
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

          // Calculate initial discount amount (all discounts are percentage-based)
          let requestedDiscountAmount = Math.round((basePrice * discount.percentage) / 100)

          // Check per-code usage limits
          if (discount.usage_limit && discount.usage_limit > 0) {
            const { data: usageCount } = await supabase
              .from('discount_usage_computed')
              .select('id')
              .eq('user_id', userId)
              .eq('discount_code_id', discountCodeId)

            const currentUsage = usageCount?.length || 0

            if (currentUsage >= discount.usage_limit) {
              // User has exceeded per-code limit - no discount
              requestedDiscountAmount = 0
            }
          }

          // Enforce seasonal discount cap (only if discount is still applicable)
          if (requestedDiscountAmount > 0) {
            const limitResult = await checkSeasonalDiscountLimit(
              supabase,
              userId,
              discountCodeId,
              seasonId,
              requestedDiscountAmount
            )

            discountAmount = limitResult.finalAmount

            // Log if partial discount was applied
            if (limitResult.isPartialDiscount) {
              logger.logPaymentProcessing(
                'waitlist-partial-discount-applied',
                'Applied partial discount due to seasonal limit',
                {
                  userId,
                  categoryId,
                  discountCodeId,
                  requestedAmount: requestedDiscountAmount,
                  appliedAmount: discountAmount,
                  seasonalUsage: limitResult.seasonalUsage
                },
                'info'
              )
            }
          } else {
            discountAmount = requestedDiscountAmount
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
          categoryId,
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
   * Handle free waitlist charge (after discount makes it $0)
   */
  private static async handleFreeWaitlistCharge(
    userId: string,
    registrationId: string,
    categoryId: string,
    categoryName: string,
    stagingRecord: any,
    discountCodeId?: string
  ): Promise<WaitlistChargeResult> {
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

      // Note: Discount usage is now tracked via discount_usage_computed view
      // which derives data from xero_invoice_line_items

      // Trigger post-payment processing (emails, Xero sync)
      try {
        const paymentProcessor = new PaymentCompletionProcessor()
        await paymentProcessor.processPaymentCompletion({
          event_type: 'user_registrations',
          record_id: registrationId,
          user_id: userId,
          payment_id: paymentRecord.id,
          amount: 0,
          trigger_source: 'free_waitlist',
          timestamp: new Date().toISOString(),
          metadata: {
            xero_staging_record_id: stagingRecord.id
          }
        })
      } catch (error) {
        // Log error but don't fail the payment - emails/Xero can be handled manually if needed
        logger.logPaymentProcessing(
          'free-waitlist-post-payment-processing-failed',
          'Failed to process post-payment actions for free waitlist charge',
          {
            userId,
            registrationId,
            categoryName,
            paymentId: paymentRecord.id,
            error: error instanceof Error ? error.message : String(error)
          },
          'error'
        )
      }

      logger.logPaymentProcessing(
        'free-waitlist-charge-success',
        'Successfully processed free waitlist charge',
        {
          userId,
          registrationId,
          categoryName,
          paymentId: paymentRecord.id
        },
        'info'
      )

      return {
        paymentId: paymentRecord.id,
        amountCharged: 0,
        success: true,
        paymentIntentId: undefined // No Stripe payment for free charges
      }
    } catch (error) {
      logger.logPaymentProcessing(
        'free-waitlist-charge-failed',
        'Failed to process free waitlist charge',
        {
          userId,
          registrationId,
          categoryName,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      throw error
    }
  }
}
