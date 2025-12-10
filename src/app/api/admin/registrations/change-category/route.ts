import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'
import Stripe from 'stripe'
import { xeroStagingManager } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: process.env.STRIPE_API_VERSION as any,
})

interface DiscountInfo {
  code: string
  percentage: number
  amountSaved: number
}

interface DiscountCodeInfo {
  id: string
  code: string
  percentage: number
  category_id: string
}

interface ChangeCategoryRequest {
  userRegistrationId: string
  newCategoryId: string
  reason: string
  discountCodes?: DiscountCodeInfo[]
  discountInfo?: DiscountInfo
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const logger = Logger.getInstance()

  try {
    // Check admin authorization
    const { data: { user: authUser } } = await supabase.auth.getUser()
    
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .single()

    if (!currentUser?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse request
    const body: ChangeCategoryRequest = await request.json()
    const { userRegistrationId, newCategoryId, reason, discountCodes, discountInfo } = body

    if (!userRegistrationId || !newCategoryId || !reason?.trim()) {
      return NextResponse.json({
        error: 'User registration ID, new category ID, and reason are required'
      }, { status: 400 })
    }

    // Get discount code details if provided
    let discountCodeId: string | undefined
    let discountCategoryId: string | undefined
    if (discountInfo && discountCodes && discountCodes.length > 0) {
      const matchingDiscount = discountCodes[0] // Use first discount code
      discountCodeId = matchingDiscount.id
      discountCategoryId = matchingDiscount.category_id
    }

    // Get current registration
    const { data: registration, error: regError } = await supabase
      .from('user_registrations')
      .select(`
        *,
        users (
          id,
          first_name,
          last_name,
          email,
          stripe_payment_method_id,
          stripe_customer_id
        ),
        registration_categories (
          id,
          price,
          custom_name,
          category_id,
          accounting_code,
          categories (
            name
          )
        ),
        registrations (
          id,
          name,
          season_id
        )
      `)
      .eq('id', userRegistrationId)
      .single()

    if (regError) {
      logger.logSystem('category-change-error', 'Failed to fetch registration', {
        userRegistrationId,
        error: regError.message
      })
      return NextResponse.json({ error: 'Registration not found', details: regError.message }, { status: 404 })
    }

    if (!registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    if (registration.payment_status !== 'paid') {
      return NextResponse.json({
        error: `Cannot change category for registration with status: ${registration.payment_status}`
      }, { status: 400 })
    }

    if (registration.registration_category_id === newCategoryId) {
      return NextResponse.json({ 
        error: 'User is already registered in this category' 
      }, { status: 400 })
    }

    // Get new category
    const { data: newCategory, error: catError } = await supabase
      .from('registration_categories')
      .select(`
        id,
        price,
        custom_name,
        category_id,
        accounting_code,
        max_capacity,
        categories (
          name
        )
      `)
      .eq('id', newCategoryId)
      .eq('registration_id', registration.registration_id)
      .single()

    if (catError) {
      logger.logSystem('category-change-error', 'Failed to fetch new category', {
        newCategoryId,
        registrationId: registration.registration_id,
        error: catError.message
      })
      return NextResponse.json({ error: 'Target category not found', details: catError.message }, { status: 404 })
    }

    if (!newCategory) {
      return NextResponse.json({ error: 'Target category not found' }, { status: 404 })
    }

    // Check capacity
    const { count: currentCount } = await supabase
      .from('user_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('registration_category_id', newCategoryId)
      .or(`payment_status.eq.paid,payment_status.eq.processing,and(payment_status.eq.awaiting_payment,reservation_expires_at.gt.${new Date().toISOString()})`)

    if (newCategory.max_capacity && currentCount !== null && currentCount >= newCategory.max_capacity) {
      return NextResponse.json({
        error: `Target category is at full capacity (${currentCount}/${newCategory.max_capacity})`
      }, { status: 400 })
    }

    // Calculate price difference (using discounted price if discount was applied)
    const oldPrice = registration.amount_paid
    const newPriceBase = newCategory.price
    const discountAmount = discountInfo?.amountSaved || 0
    const newPrice = newPriceBase - discountAmount  // Discounted price
    const priceDifference = newPrice - oldPrice
    
    const oldCat = Array.isArray(registration.registration_categories) ? registration.registration_categories[0] : registration.registration_categories
    const oldCategory = oldCat?.categories ? (Array.isArray(oldCat.categories) ? oldCat.categories[0] : oldCat.categories) : null
    const oldCategoryName = oldCategory?.name || oldCat?.custom_name || 'Unknown'
    
    const newCat = Array.isArray(newCategory.categories) ? newCategory.categories[0] : newCategory.categories
    const newCategoryName = newCat?.name || newCategory.custom_name || 'Unknown'

    const user = Array.isArray(registration.users) ? registration.users[0] : registration.users

    logger.logSystem('category-change-initiated', 'Processing category change', {
      registrationId: userRegistrationId,
      userId: registration.user_id,
      oldCategory: oldCategoryName,
      newCategory: newCategoryName,
      priceDifference
    })

    if (priceDifference > 0) {
      // NEW PRICE > OLD PRICE: User owes money
      if (!user.stripe_payment_method_id) {
        return NextResponse.json({
          error: 'User must have a payment method on file to upgrade category'
        }, { status: 400 })
      }

      // Get accounting code - it's on registration_categories, not categories
      const accountingCode = newCategory.accounting_code

      if (!accountingCode) {
        return NextResponse.json({
          error: 'New category has no accounting code configured',
          debug: {
            registrationCategoryId: newCategory.id,
            hasAccountingCode: !!accountingCode,
            newCategory: newCategory
          }
        }, { status: 400 })
      }

      // Create Xero staging record BEFORE charging
      const payment_items = [{
        item_type: 'registration' as const,
        item_id: registration.registration_id,
        item_amount: centsToCents(newPriceBase), // Full price (before discount)
        description: `Category Upgrade: ${oldCategoryName} → ${newCategoryName}`,
        accounting_code: accountingCode
      }]

      // Add discount line item if applicable
      if (discountInfo && discountAmount > 0 && discountCategoryId) {
        const { data: discountCategory } = await supabase
          .from('discount_categories')
          .select('accounting_code')
          .eq('id', discountCategoryId)
          .single()

        if (discountCategory?.accounting_code) {
          payment_items.push({
            item_type: 'discount' as const,
            item_id: null,
            item_amount: centsToCents(-discountAmount), // Negative for discount
            description: `Discount: ${discountInfo.code} (${discountInfo.percentage}%)`,
            accounting_code: discountCategory.accounting_code,
            discount_code_id: discountCodeId
          })
        }
      }

      const stagingData = {
        user_id: registration.user_id,
        total_amount: centsToCents(newPriceBase),
        discount_amount: centsToCents(discountAmount),
        final_amount: centsToCents(priceDifference), // Net amount after discount
        payment_items,
        discount_codes_used: discountInfo ? [{
          code: discountInfo.code,
          amount_saved: centsToCents(discountAmount),
          category_name: '',
          accounting_code: '',
          discount_code_id: discountCodeId
        }] : [],
        stripe_payment_intent_id: null // Will be added after payment intent created
      }

      const stagingRecord = await xeroStagingManager.createImmediateStaging(stagingData)

      if (!stagingRecord) {
        return NextResponse.json({
          error: 'Failed to create Xero staging record'
        }, { status: 500 })
      }

      // Create payment intent for difference
      const paymentIntent = await stripe.paymentIntents.create({
        amount: priceDifference,
        currency: 'aud',
        customer: user.stripe_customer_id,
        payment_method: user.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        description: `Category change: ${oldCategoryName} → ${newCategoryName}`,
        metadata: {
          user_id: registration.user_id,
          registration_id: registration.registration_id,
          user_registration_id: userRegistrationId,
          category_change: 'true',
          old_category: oldCategoryName,
          new_category: newCategoryName,
          reason: reason,
          xero_staging_record_id: stagingRecord.id // Link to staging record for webhook
        }
      })

      if (paymentIntent.status !== 'succeeded') {
        return NextResponse.json({
          error: 'Payment for category upgrade failed'
        }, { status: 400 })
      }

      // Create payment record
      const { data: newPayment } = await supabase
        .from('payments')
        .insert({
          user_id: registration.user_id,
          final_amount: priceDifference,
          stripe_payment_intent_id: paymentIntent.id,
          status: 'completed',
          completed_at: new Date().toISOString(),
          metadata: {
            type: 'category_change_upgrade',
            old_category_id: registration.registration_category_id,
            new_category_id: newCategoryId,
            user_registration_id: userRegistrationId
          }
        })
        .select()
        .single()

      // Update staging record with payment ID and payment intent ID
      await supabase
        .from('xero_invoices')
        .update({
          payment_id: newPayment?.id,
          staging_metadata: {
            ...stagingRecord.staging_metadata,
            stripe_payment_intent_id: paymentIntent.id
          }
        })
        .eq('id', stagingRecord.id)

      // Update registration
      await supabase
        .from('user_registrations')
        .update({
          registration_category_id: newCategoryId,
          registration_fee: newCategory.price,
          amount_paid: newPrice, // Discounted price
          payment_id: newPayment?.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', userRegistrationId)

      // Record discount usage if discount was applied
      if (discountCodeId && discountCategoryId && discountAmount > 0) {
        await supabase
          .from('discount_usage')
          .insert({
            user_id: registration.user_id,
            discount_code_id: discountCodeId,
            discount_category_id: discountCategoryId,
            season_id: (registration.registrations as any).season_id,
            amount_saved: discountAmount,
            registration_id: registration.registration_id
          })
      }

      logger.logSystem('category-change-complete', 'Category upgraded with payment', {
        registrationId: userRegistrationId,
        paymentId: newPayment?.id,
        amountCharged: priceDifference,
        xeroStagingId: stagingRecord.id,
        discountApplied: discountInfo ? `${discountInfo.code} (${discountInfo.percentage}%)` : 'none'
      })

      return NextResponse.json({
        success: true,
        action: 'charged',
        amount: priceDifference,
        message: `Category changed successfully. User charged $${(priceDifference / 100).toFixed(2)}.`
      })

    } else if (priceDifference < 0) {
      // OLD PRICE > NEW PRICE: User gets refund
      const refundAmount = Math.abs(priceDifference)

      if (!registration.payment_id) {
        return NextResponse.json({
          error: 'Original payment not found for refund processing'
        }, { status: 404 })
      }

      const { data: originalPayment } = await supabase
        .from('payments')
        .select('stripe_payment_intent_id')
        .eq('id', registration.payment_id)
        .single()

      if (!originalPayment?.stripe_payment_intent_id) {
        return NextResponse.json({
          error: 'Cannot process refund - original payment has no Stripe payment intent'
        }, { status: 400 })
      }

      // Get accounting code for the credit note (use old category code)
      const oldCat = Array.isArray(registration.registration_categories) ? registration.registration_categories[0] : registration.registration_categories
      const accountingCode = oldCat?.accounting_code

      if (!accountingCode) {
        return NextResponse.json({
          error: 'Old category has no accounting code configured'
        }, { status: 400 })
      }

      // Create refund record
      const { data: refund } = await supabase
        .from('refunds')
        .insert({
          payment_id: registration.payment_id,
          user_id: registration.user_id,
          amount: refundAmount,
          reason: `Category change: ${oldCategoryName} → ${newCategoryName}. ${reason}`,
          status: 'pending',
          processed_by: authUser.id,
        })
        .select()
        .single()

      if (!refund) {
        return NextResponse.json({ error: 'Failed to create refund record' }, { status: 500 })
      }

      // Create credit note staging record
      const { data: creditNoteStaging, error: creditError } = await supabase
        .from('xero_invoices')
        .insert({
          payment_id: registration.payment_id,
          invoice_type: 'ACCRECCREDIT', // Credit note type
          invoice_status: 'DRAFT',
          total_amount: refundAmount,
          net_amount: refundAmount,
          sync_status: 'staged',
          staged_at: new Date().toISOString(),
          staging_metadata: {
            refund_id: refund.id,
            user_id: registration.user_id,
            refund_type: 'category_change',
            refund_amount: refundAmount,
            original_payment_id: registration.payment_id
          }
        })
        .select()
        .single()

      if (creditError || !creditNoteStaging) {
        return NextResponse.json({
          error: 'Failed to create credit note staging'
        }, { status: 500 })
      }

      // Create line item for the credit note
      await supabase
        .from('xero_invoice_line_items')
        .insert({
          xero_invoice_id: creditNoteStaging.id,
          description: `Category Downgrade: ${oldCategoryName} → ${newCategoryName}`,
          quantity: 1,
          unit_amount: refundAmount,
          line_amount: refundAmount,
          account_code: accountingCode,
          tax_type: 'NONE',
          line_item_type: 'refund'
        })

      // Process Stripe refund
      try {
        await supabase
          .from('refunds')
          .update({ status: 'processing' })
          .eq('id', refund.id)

        const stripeRefund = await stripe.refunds.create({
          payment_intent: originalPayment.stripe_payment_intent_id,
          amount: refundAmount,
          reason: 'requested_by_customer',
          metadata: {
            refund_id: refund.id,
            processed_by: authUser.id,
            category_change: 'true',
            staging_id: creditNoteStaging.id // Link to staging record for webhook
          }
        })

        await supabase
          .from('refunds')
          .update({
            stripe_refund_id: stripeRefund.id,
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', refund.id)

        // Update registration (don't change payment_status to 'refunded' - user is still registered)
        await supabase
          .from('user_registrations')
          .update({
            registration_category_id: newCategoryId,
            registration_fee: newCategory.price,
            amount_paid: newPrice,
            updated_at: new Date().toISOString()
          })
          .eq('id', userRegistrationId)

        logger.logSystem('category-change-complete', 'Category downgraded with refund', {
          registrationId: userRegistrationId,
          refundId: refund.id,
          amountRefunded: refundAmount,
          xeroStagingId: creditNoteStaging.id
        })

        return NextResponse.json({
          success: true,
          action: 'refunded',
          amount: refundAmount,
          message: `Category changed successfully. User refunded $${(refundAmount / 100).toFixed(2)}.`
        })

      } catch (stripeError) {
        await supabase
          .from('refunds')
          .update({
            status: 'failed',
            failure_reason: stripeError instanceof Error ? stripeError.message : 'Unknown error',
          })
          .eq('id', refund.id)

        // Mark staging as failed
        await supabase
          .from('xero_invoices')
          .update({
            sync_status: 'failed',
            sync_error: stripeError instanceof Error ? stripeError.message : 'Unknown error'
          })
          .eq('id', creditNoteStaging.id)

        return NextResponse.json({
          error: 'Refund processing failed'
        }, { status: 500 })
      }

    } else {
      // PRICES EQUAL: Check if accounting codes differ
      const oldCat = Array.isArray(registration.registration_categories) ? registration.registration_categories[0] : registration.registration_categories

      // Get accounting codes from registration_categories
      const oldAccountingCode = oldCat?.accounting_code
      const newAccountingCode = newCategory?.accounting_code

      // Check if we need to create accounting records
      const needsAccountingRecords = oldPrice > 0 && oldAccountingCode && newAccountingCode && oldAccountingCode !== newAccountingCode

      if (needsAccountingRecords) {
        // Same price but different accounting codes - create zero-value invoice with two line items
        logger.logSystem('category-change-accounting-transfer', 'Creating zero-value invoice for accounting code change', {
          registrationId: userRegistrationId,
          oldCode: oldAccountingCode,
          newCode: newAccountingCode,
          amount: oldPrice
        })

        // Create Xero staging record with line items showing full prices and discounts
        const payment_items = []
        let totalDiscountAmount = 0

        // Get old category full price (before any discount)
        const oldCategoryPrice = (oldCat as any)?.price || oldPrice

        // Credit old category at full price
        payment_items.push({
          item_type: 'registration' as const,
          item_id: registration.registration_id,
          item_amount: centsToCents(-oldCategoryPrice),
          description: `Category Change (From): ${oldCategoryName}`,
          accounting_code: oldAccountingCode
        })

        // If old category had a discount, add it back (negative credit = charge)
        const oldDiscountAmount = oldCategoryPrice - oldPrice
        if (oldDiscountAmount > 0 && discountCodes && discountCodes.length > 0) {
          const oldDiscount = discountCodes.find(dc =>
            dc.category_id === (oldCat as any)?.category_id
          )
          if (oldDiscount && discountCategoryId) {
            const { data: discountCategory } = await supabase
              .from('discount_categories')
              .select('accounting_code')
              .eq('id', discountCategoryId)
              .single()

            if (discountCategory?.accounting_code) {
              payment_items.push({
                item_type: 'discount' as const,
                item_id: null,
                item_amount: centsToCents(oldDiscountAmount), // Positive to reverse the discount
                description: `Reverse Discount: ${oldDiscount.code} (${oldDiscount.percentage}%)`,
                accounting_code: discountCategory.accounting_code,
                discount_code_id: oldDiscount.id
              })
            }
          }
        }

        // Charge new category at full price
        payment_items.push({
          item_type: 'registration' as const,
          item_id: registration.registration_id,
          item_amount: centsToCents(newPriceBase),
          description: `Category Change (To): ${newCategoryName}`,
          accounting_code: newAccountingCode
        })

        // If new category has a discount, apply it (negative charge = credit)
        if (discountInfo && discountAmount > 0 && discountCategoryId) {
          const { data: discountCategory } = await supabase
            .from('discount_categories')
            .select('accounting_code')
            .eq('id', discountCategoryId)
            .single()

          if (discountCategory?.accounting_code) {
            payment_items.push({
              item_type: 'discount' as const,
              item_id: null,
              item_amount: centsToCents(-discountAmount), // Negative for discount
              description: `Discount: ${discountInfo.code} (${discountInfo.percentage}%)`,
              accounting_code: discountCategory.accounting_code,
              discount_code_id: discountCodeId
            })
            totalDiscountAmount = discountAmount
          }
        }

        const stagingData = {
          user_id: registration.user_id,
          total_amount: 0, // Net zero
          discount_amount: centsToCents(totalDiscountAmount),
          final_amount: 0,
          payment_items,
          discount_codes_used: discountInfo ? [{
            code: discountInfo.code,
            amount_saved: centsToCents(discountAmount),
            category_name: '',
            accounting_code: '',
            discount_code_id: discountCodeId
          }] : [],
          stripe_payment_intent_id: null
        }

        const stagingRecord = await xeroStagingManager.createImmediateStaging(stagingData, { isFree: true })

        if (!stagingRecord) {
          return NextResponse.json({
            error: 'Failed to create Xero staging record for accounting transfer'
          }, { status: 500 })
        }

        // Create a zero-value payment record to link the staging
        const { data: transferPayment } = await supabase
          .from('payments')
          .insert({
            user_id: registration.user_id,
            total_amount: 0,
            final_amount: 0,
            stripe_payment_intent_id: null,
            status: 'completed',
            payment_method: 'free',
            completed_at: new Date().toISOString(),
            metadata: {
              type: 'category_change_accounting_transfer',
              old_category_id: registration.registration_category_id,
              new_category_id: newCategoryId,
              user_registration_id: userRegistrationId,
              old_accounting_code: oldAccountingCode,
              new_accounting_code: newAccountingCode
            }
          })
          .select()
          .single()

        // Link staging to payment
        await supabase
          .from('xero_invoices')
          .update({ payment_id: transferPayment?.id })
          .eq('id', stagingRecord.id)

        // Update the staging status to pending (since there's no Stripe webhook for free transactions)
        await supabase
          .from('xero_invoices')
          .update({
            sync_status: 'pending',
            invoice_status: 'AUTHORISED'
          })
          .eq('id', stagingRecord.id)

        // Update registration
        await supabase
          .from('user_registrations')
          .update({
            registration_category_id: newCategoryId,
            updated_at: new Date().toISOString()
          })
          .eq('id', userRegistrationId)

        // Record discount usage if discount was applied to new category
        if (discountCodeId && discountCategoryId && discountAmount > 0) {
          await supabase
            .from('discount_usage')
            .insert({
              user_id: registration.user_id,
              discount_code_id: discountCodeId,
              discount_category_id: discountCategoryId,
              season_id: (registration.registrations as any).season_id,
              amount_saved: discountAmount,
              registration_id: registration.registration_id
            })
        }

        logger.logSystem('category-change-complete', 'Category changed with accounting transfer', {
          registrationId: userRegistrationId,
          xeroStagingId: stagingRecord.id,
          paymentId: transferPayment?.id,
          discountApplied: discountInfo ? `${discountInfo.code} (${discountInfo.percentage}%)` : 'none'
        })

        return NextResponse.json({
          success: true,
          action: 'updated',
          amount: 0,
          message: 'Category changed successfully (accounting codes updated in Xero).'
        })
      } else {
        // No accounting records needed (both $0 or same accounting code)
        await supabase
          .from('user_registrations')
          .update({
            registration_category_id: newCategoryId,
            updated_at: new Date().toISOString()
          })
          .eq('id', userRegistrationId)

        logger.logSystem('category-change-complete', 'Category changed (no accounting impact)', {
          registrationId: userRegistrationId,
          reason: oldPrice === 0 ? 'both_categories_free' : 'same_accounting_code'
        })

        return NextResponse.json({
          success: true,
          action: 'updated',
          amount: 0,
          message: 'Category changed successfully (no price difference).'
        })
      }
    }

  } catch (error) {
    logger.logSystem('category-change-error', 'Unexpected error', { 
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
