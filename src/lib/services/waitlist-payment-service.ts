import Stripe from 'stripe'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { xeroStagingManager, StagingPaymentData } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'

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

      // Get registration details
      const { data: registration, error: registrationError } = await supabase
        .from('registrations')
        .select('name')
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
            categoryId,
            discountCodeId,
            userId
          )
          discountCode = calculated.discountCode

          if (discountCode) {
            // Apply the same discount percentage to the new base price
            discountAmount = Math.round((effectiveBasePrice * discountCode.percentage) / 100)
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
          categoryId,
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
          categoryName,
          stagingRecord,
          discountCodeId
        )
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

      // Record discount usage if applicable
      if (discountCodeId && discountAmount > 0) {
        await this.recordDiscountUsage(userId, discountCodeId, registrationId, discountAmount)
      }

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
   */
  static async calculateChargeAmount(
    categoryId: string,
    discountCodeId?: string,
    userId?: string
  ): Promise<{ finalAmount: number; discountAmount: number; discountCode?: any }> {
    try {
      const supabase = await createClient()

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

      // Record discount usage if applicable
      if (discountCodeId) {
        // Get the base price to record the discount amount
        const { data: category } = await supabase
          .from('registration_categories')
          .select('price')
          .eq('id', stagingRecord.staging_metadata?.categoryId)
          .single()

        const discountAmount = category?.price || 0
        await this.recordDiscountUsage(userId, discountCodeId, registrationId, discountAmount)
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

      // Check if usage already exists to prevent duplicates
      const { data: existingUsage } = await supabase
        .from('discount_usage')
        .select('id')
        .eq('user_id', userId)
        .eq('discount_code_id', discountCodeId)
        .eq('registration_id', registrationId)
        .single()

      if (!existingUsage) {
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
