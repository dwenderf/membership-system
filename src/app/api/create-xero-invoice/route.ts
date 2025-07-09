import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createXeroInvoiceBeforePayment, PrePaymentInvoiceData } from '@/lib/xero-invoices'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
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
      
      // Build payment items
      const paymentItems = [{
        item_type: 'registration' as const,
        item_id: registrationId,
        amount: paymentIntent.amount,
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
      
      // Calculate base membership amount
      const getMembershipAmount = () => {
        if (paymentOption === 'assistance') {
          return assistanceAmount || 0
        }
        // For donations and standard, use the base membership price calculation
        const basePrice = durationMonths === 12 ? membership.price_annual : membership.price_monthly * durationMonths
        return basePrice
      }
      
      const membershipAmount = getMembershipAmount()
      
      // Build payment items
      const paymentItems = [{
        item_type: 'membership' as const,
        item_id: membershipId,
        amount: membershipAmount,
        description: `${membershipName} - ${durationMonths} months${paymentOption === 'assistance' ? ' (Financial Assistance)' : ''}`,
        accounting_code: membership.accounting_code
      }]

      // Add donation item if applicable
      if (paymentOption === 'donation' && donationAmount > 0) {
        paymentItems.push({
          item_type: 'donation' as const,
          item_id: membershipId,
          amount: donationAmount,
          description: 'Donation',
          accounting_code: undefined // Will use default donation accounting code
        })
      }

      xeroInvoiceData = {
        user_id: user.id,
        total_amount: paymentIntent.amount,
        discount_amount: 0, // No discounts in membership flow yet
        final_amount: paymentIntent.amount,
        payment_items: paymentItems,
        discount_codes_used: [] // No discount codes in membership flow yet
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