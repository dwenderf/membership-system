import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkSeasonalDiscountLimit, resolveEffectiveDiscountLimits, resolveDiscountPercentage, DiscountCodeWithCategory } from '@/lib/services/discount-limit-service'

interface DiscountValidationResult {
  isValid: boolean
  discountCodeId?: string // Discount code ID for easy access
  discountCode?: {
    id: string
    code: string
    percentage: number
    category: {
      id: string
      name: string
      accounting_code: string
      max_discount_per_user_per_season: number | null
    }
  }
  discountAmount?: number // In cents
  isPartialDiscount?: boolean // True when discount was capped by season limit
  partialDiscountMessage?: string // Explanation of partial discount
  error?: string
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { code, registrationId, paymentId, amount, isRefund = false } = body
    
    if (!code || !registrationId || !amount) {
      return NextResponse.json({ 
        error: 'Missing required fields: code, registrationId, amount' 
      }, { status: 400 })
    }

    // Get the registration to determine the season and owning customer
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('season_id, user_id')
      .eq('id', registrationId)
      .single()

    if (regError || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    // Find the discount code with its category
    const { data: discountCode, error: codeError } = await supabase
      .from('discount_codes')
      .select(`
        id,
        code,
        percentage,
        uses_user_allowance,
        is_active,
        valid_from,
        valid_until,
        discount_categories (
          id,
          name,
          accounting_code,
          max_discount_per_user_per_season,
          requires_user_allowance,
          default_percentage,
          is_active
        )
      `)
      .eq('code', code.toUpperCase().trim())
      .eq('is_active', true)
      .single()

    if (codeError || !discountCode) {
      const result: DiscountValidationResult = {
        isValid: false,
        error: 'Invalid discount code'
      }
      return NextResponse.json(result)
    }

    // Check if category is active
    const discountCategory = discountCode.discount_categories as any
    
    if (!discountCategory?.is_active) {
      const result: DiscountValidationResult = {
        isValid: false,
        error: 'Discount code category is not active'
      }
      return NextResponse.json(result)
    }

    // Check date validity
    const now = new Date()
    if (discountCode.valid_from && new Date(discountCode.valid_from) > now) {
      const result: DiscountValidationResult = {
        isValid: false,
        error: 'Discount code is not yet valid'
      }
      return NextResponse.json(result)
    }

    if (discountCode.valid_until && new Date(discountCode.valid_until) < now) {
      const result: DiscountValidationResult = {
        isValid: false,
        error: 'Discount code has expired'
      }
      return NextResponse.json(result)
    }

    const category = discountCategory as any
    const codeWithCategory: DiscountCodeWithCategory = {
      id: discountCode.id,
      code: discountCode.code,
      percentage: discountCode.percentage != null ? parseFloat(String(discountCode.percentage)) : null,
      uses_user_allowance: discountCode.uses_user_allowance,
      category: category ? {
        id: category.id,
        name: category.name,
        max_discount_per_user_per_season: category.max_discount_per_user_per_season,
        requires_user_allowance: category.requires_user_allowance,
        default_percentage: category.default_percentage != null ? parseFloat(String(category.default_percentage)) : null
      } : null
    }

    let discountAmount = 0
    let isPartialDiscount = false
    let partialDiscountMessage = ''
    let effectivePct: number | null = discountCode.percentage != null ? parseFloat(String(discountCode.percentage)) : null

    if (isRefund) {
      let originalDiscountAmount: number | null = null

      if (paymentId) {
        // Query xero_invoices filtering strictly by payment_id, invoice_type = 'ACCREC', and sync_status IN ('synced', 'pending')
        const { data: originalInvoices, error: invoiceError } = await supabase
          .from('xero_invoices')
          .select('id')
          .eq('payment_id', paymentId)
          .eq('invoice_type', 'ACCREC')
          .in('sync_status', ['synced', 'pending'])

        if (invoiceError) {
          console.error('[validate-discount-code] Error querying original invoice:', invoiceError)
        }

        if (originalInvoices && originalInvoices.length > 1) {
          console.error('[validate-discount-code] Multiple synced/pending ACCREC invoices found for payment:', paymentId)
          return NextResponse.json({ isValid: false, error: 'Multiple original invoices found for payment' })
        }

        if (originalInvoices && originalInvoices.length === 1) {
          const xeroInvoiceId = originalInvoices[0].id
          const { data: lineItems, error: lineError } = await supabase
            .from('xero_invoice_line_items')
            .select('id, line_amount')
            .eq('xero_invoice_id', xeroInvoiceId)
            .eq('discount_code_id', discountCode.id)
            .eq('line_item_type', 'discount')

          if (lineError) {
            console.error('[validate-discount-code] Error querying discount line item:', lineError)
          }

          if (lineItems && lineItems.length > 1) {
            console.error('[validate-discount-code] Multiple discount line items found on original invoice:', xeroInvoiceId)
            return NextResponse.json({ isValid: false, error: 'Multiple discount line items found on original invoice' })
          }

          if (lineItems && lineItems.length === 1) {
            originalDiscountAmount = Math.abs(lineItems[0].line_amount)
          }
        }
      }

      if (originalDiscountAmount !== null) {
        discountAmount = originalDiscountAmount
      } else {
        // Split fallback strategy for 0 invoices / 0 line items found
        if (discountCode.uses_user_allowance) {
          // The customer never actually applied this gated code at checkout (e.g. they forgot to
          // enter it). An admin can retroactively apply it during a refund, but only if the
          // registration's owner actually has an allowance for it - so resolve eligibility against
          // the customer, not the admin performing the refund.
          const effectiveLimit = await resolveEffectiveDiscountLimits(
            supabase,
            registration.user_id,
            category.id,
            registration.season_id,
            codeWithCategory.category
          )

          if (!effectiveLimit.isEligible) {
            console.warn('[validate-discount-code] Refund requested for allowance-driven code the customer is not eligible for:', { code: discountCode.code, paymentId, registrationId })
            return NextResponse.json({ isValid: false, error: "This code isn't available to this customer's account." })
          }

          const pct = resolveDiscountPercentage(discountCode, effectiveLimit)

          if (pct == null || isNaN(pct)) {
            console.error('[validate-discount-code] Percentage unresolvable for retroactive refund application:', { code: discountCode.code, paymentId, registrationId })
            return NextResponse.json({ isValid: false, error: "This code isn't available to this customer's account." })
          }

          effectivePct = pct
          const requestedDiscountAmount = Math.round((amount * pct) / 100)

          const limitResult = await checkSeasonalDiscountLimit(
            supabase,
            registration.user_id,
            discountCode.id,
            registration.season_id,
            requestedDiscountAmount,
            {
              isRefund: false,
              discountCode: codeWithCategory,
              effectiveLimit
            }
          )

          const maxAllowed = effectiveLimit.maxAllowed ?? category?.max_discount_per_user_per_season ?? 0

          if (limitResult.isAtLimit) {
            return NextResponse.json({
              isValid: false,
              error: `This customer has already reached their $${(maxAllowed / 100).toFixed(2)} season limit for ${category?.name || ''}. No additional discount can be applied.`
            })
          }

          if (limitResult.isPartialDiscount) {
            discountAmount = limitResult.finalAmount
            isPartialDiscount = true
            partialDiscountMessage = `Applied $${(discountAmount / 100).toFixed(2)} discount (${discountCode.code}). Customer has already used part of their $${(maxAllowed / 100).toFixed(2)} season limit for ${category?.name || ''}.`
          } else {
            discountAmount = requestedDiscountAmount
          }

          console.warn('[validate-discount-code] Retroactively applying allowance-driven code during refund (no original line item found):', { code: discountCode.code, paymentId, registrationId, discountAmount })
        } else {
          console.warn('[validate-discount-code] Original discount line item not found for refund of fixed-percentage code; using percentage fallback:', { code: discountCode.code, paymentId })
          const fallbackPct = parseFloat(String(discountCode.percentage)) || 0
          discountAmount = Math.round((amount * fallbackPct) / 100)
        }
      }
    } else {
      // Non-refund validation: resolve effective limit first to determine real percentage
      const effectiveLimit = await resolveEffectiveDiscountLimits(
        supabase,
        user.id,
        category.id,
        registration.season_id,
        codeWithCategory.category
      )

      if (!effectiveLimit.isEligible) {
        return NextResponse.json({
          isValid: false,
          error: "This code isn't available to your account."
        })
      }

      const pct = resolveDiscountPercentage(discountCode, effectiveLimit)

      if (pct == null || isNaN(pct)) {
        console.error('[validate-discount-code] Percentage unresolvable:', { code: discountCode.code, uses_user_allowance: discountCode.uses_user_allowance })
        return NextResponse.json({
          isValid: false,
          error: "This code isn't available to your account."
        })
      }

      effectivePct = pct
      const requestedDiscountAmount = Math.round((amount * pct) / 100)

      const limitResult = await checkSeasonalDiscountLimit(
        supabase,
        user.id,
        discountCode.id,
        registration.season_id,
        requestedDiscountAmount,
        {
          isRefund: false,
          discountCode: codeWithCategory,
          effectiveLimit
        }
      )

      const maxAllowed = effectiveLimit.maxAllowed ?? category?.max_discount_per_user_per_season ?? 0

      if (limitResult.isAtLimit) {
        return NextResponse.json({
          isValid: false,
          error: `You have already reached your $${(maxAllowed / 100).toFixed(2)} season limit for ${category?.name || ''}. No additional discount can be applied.`
        })
      }

      if (limitResult.isPartialDiscount) {
        discountAmount = limitResult.finalAmount
        isPartialDiscount = true
        partialDiscountMessage = `Applied $${(discountAmount / 100).toFixed(2)} discount (${discountCode.code}). You've reached your $${(maxAllowed / 100).toFixed(2)} season limit for ${category?.name || ''}.`
      } else {
        discountAmount = requestedDiscountAmount
      }
    }

    // Valid discount code
    const result: DiscountValidationResult = {
      isValid: true,
      discountCodeId: discountCode.id, // Add for easy access
      discountCode: {
        id: discountCode.id,
        code: discountCode.code,
        percentage: effectivePct ?? 0,
        category: {
          id: category.id,
          name: category.name,
          accounting_code: category.accounting_code,
          max_discount_per_user_per_season: category.max_discount_per_user_per_season
        }
      },
      discountAmount,
      isPartialDiscount,
      partialDiscountMessage: isPartialDiscount ? partialDiscountMessage : undefined
    }

    return NextResponse.json(result)
    
  } catch (error) {
    console.error('Error validating discount code:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}