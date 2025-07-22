import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createXeroInvoiceBeforePayment, PrePaymentInvoiceData } from '@/lib/xero/invoices'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-05-28.basil',
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { paymentIntentId, isRegistration } = body
    
    if (!paymentIntentId) {
      return NextResponse.json({ error: 'Payment intent ID required' }, { status: 400 })
    }

    // Get the payment intent from Stripe to access metadata
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
    
    // Verify this payment intent belongs to the authenticated user
    if (paymentIntent.metadata.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Build invoice data based on payment type
    let xeroInvoiceData: PrePaymentInvoiceData
    
    if (isRegistration) {
      // Build registration invoice data
      const registrationId = paymentIntent.metadata.registrationId
      const categoryId = paymentIntent.metadata.categoryId
      const originalAmount = parseInt(paymentIntent.metadata.originalAmount || '0')
      const discountAmount = parseInt(paymentIntent.metadata.discountAmount || '0')
      const discountCode = paymentIntent.metadata.discountCode
      
      // Get registration details
      const { data: registration } = await supabase
        .from('registrations')
        .select(`
          *,
          registration_categories!inner(
            *,
            category:categories(name)
          )
        `)
        .eq('id', registrationId)
        .eq('registration_categories.id', categoryId)
        .single()
      
      if (!registration) {
        return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
      }
      
      const selectedCategory = registration.registration_categories[0]
      const categoryName = selectedCategory.category?.name || selectedCategory.custom_name || 'Registration'
      
      // Build payment items - always show full registration price
      const paymentItems = [{
        item_type: 'registration' as const,
        item_id: registrationId,
        amount: originalAmount,
        description: `Registration: ${registration.name} - ${categoryName}`,
        accounting_code: selectedCategory.accounting_code || registration.accounting_code
      }]

      // Add discount line items if applicable
      const discountItems = []
      if (discountCode && discountAmount > 0) {
        const discountCategoryName = paymentIntent.metadata.discountCategoryName || 'Registration Discount'
        const discountAccountingCode = paymentIntent.metadata.accountingCode
        
        discountItems.push({
          code: discountCode,
          amount_saved: discountAmount,
          category_name: discountCategoryName,
          accounting_code: discountAccountingCode
        })
      }

      xeroInvoiceData = {
        user_id: user.id,
        total_amount: originalAmount,
        discount_amount: discountAmount,
        final_amount: paymentIntent.amount,
        payment_items: paymentItems,
        discount_codes_used: discountItems
      }
    } else {
      // Build membership invoice data
      const membershipId = paymentIntent.metadata.membershipId
      const membershipName = paymentIntent.metadata.membershipName
      const durationMonths = parseInt(paymentIntent.metadata.durationMonths || '0')
      const paymentOption = paymentIntent.metadata.paymentOption
      const assistanceAmount = parseInt(paymentIntent.metadata.assistanceAmount || '0')
      const donationAmount = parseInt(paymentIntent.metadata.donationAmount || '0')
      
      // Get membership details
      const { data: membership } = await supabase
        .from('memberships')
        .select('*')
        .eq('id', membershipId)
        .single()
      
      if (!membership) {
        return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
      }
      
      // Always use full membership price for the main line item
      const basePrice = durationMonths === 12 ? membership.price_annual : membership.price_monthly * durationMonths
      
      // Build payment items - always show full membership price
      const paymentItems: Array<{
        item_type: 'membership' | 'registration' | 'discount' | 'donation'
        item_id: string | null
        amount: number
        description?: string
        accounting_code?: string
      }> = [{
        item_type: 'membership' as const,
        item_id: membershipId,
        amount: basePrice,
        description: `${membershipName} - ${durationMonths} months`,
        accounting_code: membership.accounting_code
      }]

      // Add financial assistance discount if applicable
      const discountCodesUsed = []
      if (paymentOption === 'assistance' && assistanceAmount < basePrice) {
        const assistanceDiscountAmount = basePrice - assistanceAmount
        discountCodesUsed.push({
          code: 'FINANCIAL_ASSISTANCE',
          amount_saved: assistanceDiscountAmount,
          category_name: 'Financial Assistance',
          accounting_code: undefined // Will use donation_given_default from system codes
        })
      }

      // Add donation item if applicable
      if (paymentOption === 'donation' && donationAmount > 0) {
        paymentItems.push({
          item_type: 'donation' as const,
          item_id: membershipId,
          amount: donationAmount,
          description: 'Donation',
          accounting_code: undefined // Will use donation_received_default from system codes
        })
      }

      xeroInvoiceData = {
        user_id: user.id,
        total_amount: basePrice + (donationAmount || 0),
        discount_amount: discountCodesUsed.length > 0 ? discountCodesUsed[0].amount_saved : 0,
        final_amount: paymentIntent.amount,
        payment_items: paymentItems,
        discount_codes_used: discountCodesUsed
      }
    }

    // Create the invoice in Xero
    const invoiceResult = await createXeroInvoiceBeforePayment(xeroInvoiceData, { 
      markAsAuthorised: true // Mark as AUTHORISED since payment succeeded
    })
    
    if (!invoiceResult.success) {
      return NextResponse.json({ 
        error: 'Failed to create Xero invoice', 
        details: invoiceResult.error 
      }, { status: 500 })
    }

    // Update payment record with invoice info
    try {
      await supabase
        .from('payments')
        .update({
          xero_synced: true,
          xero_sync_error: null
        })
        .eq('stripe_payment_intent_id', paymentIntentId)
    } catch (updateError) {
      console.warn('⚠️ Failed to update payment record:', updateError)
      // Don't fail the request over this
    }

    // Link the invoice to the payment
    if (invoiceResult.xeroInvoiceId) {
      try {
        const { data: paymentRecord } = await supabase
          .from('payments')
          .select('id')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .single()
        
        if (paymentRecord) {
          await supabase
            .from('xero_invoices')
            .update({ 
              payment_id: paymentRecord.id,
              sync_status: 'synced',
              last_synced_at: new Date().toISOString()
            })
            .eq('xero_invoice_id', invoiceResult.xeroInvoiceId)
        }
      } catch (linkError) {
        console.warn('⚠️ Failed to link invoice to payment:', linkError)
        // Don't fail the request over this
      }
    }

    return NextResponse.json({
      success: true,
      invoiceNumber: invoiceResult.invoiceNumber,
      xeroInvoiceId: invoiceResult.xeroInvoiceId
    })

  } catch (error) {
    console.error('Error creating Xero invoice:', error)
    return NextResponse.json(
      { error: 'Failed to create Xero invoice' },
      { status: 500 }
    )
  }
}