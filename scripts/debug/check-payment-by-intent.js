#!/usr/bin/env node

/**
 * Debug script to check for a payment by Stripe payment intent ID
 * 
 * Usage: node scripts/debug/check-payment-by-intent.js <stripe_payment_intent_id>
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

async function checkPaymentByIntent(paymentIntentId) {
  if (!paymentIntentId) {
    console.error('❌ Please provide a Stripe payment intent ID as an argument')
    console.log('Usage: node scripts/debug/check-payment-by-intent.js <stripe_payment_intent_id>')
    process.exit(1)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  console.log(`🔍 Checking payment by Stripe payment intent ID: ${paymentIntentId}`)
  console.log('')

  try {
    // Check payments table
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .single()

    if (paymentError) {
      console.error('❌ Error fetching payment:', paymentError)
    } else if (payment) {
      console.log('✅ Payment found in payments table:')
      console.log(JSON.stringify(payment, null, 2))
    } else {
      console.log('❌ Payment not found in payments table')
    }

    console.log('')

    // Check xero_payments table by staging metadata
    const { data: xeroPayments, error: xeroError } = await supabase
      .from('xero_payments')
      .select('*')
      .eq('staging_metadata->>stripe_payment_intent_id', paymentIntentId)

    if (xeroError) {
      console.error('❌ Error fetching Xero payments:', xeroError)
    } else if (xeroPayments && xeroPayments.length > 0) {
      console.log(`✅ Found ${xeroPayments.length} Xero payment(s) with this payment intent ID:`)
      xeroPayments.forEach((xeroPayment, i) => {
        console.log(`\n${i+1}. Xero Payment ID: ${xeroPayment.id}`)
        console.log(JSON.stringify(xeroPayment, null, 2))
      })
    } else {
      console.log('❌ No Xero payments found with this payment intent ID')
    }

    console.log('')

    // Check xero_invoices table by staging metadata
    const { data: xeroInvoices, error: invoiceError } = await supabase
      .from('xero_invoices')
      .select('*')
      .eq('staging_metadata->>stripe_payment_intent_id', paymentIntentId)

    if (invoiceError) {
      console.error('❌ Error fetching Xero invoices:', invoiceError)
    } else if (xeroInvoices && xeroInvoices.length > 0) {
      console.log(`✅ Found ${xeroInvoices.length} Xero invoice(s) with this payment intent ID:`)
      xeroInvoices.forEach((xeroInvoice, i) => {
        console.log(`\n${i+1}. Xero Invoice ID: ${xeroInvoice.id}`)
        console.log(JSON.stringify(xeroInvoice, null, 2))
      })
    } else {
      console.log('❌ No Xero invoices found with this payment intent ID')
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error)
  }
}

// Get payment intent ID from command line arguments
const paymentIntentId = process.argv[2]

checkPaymentByIntent(paymentIntentId)
  .then(() => {
    console.log('✅ Check completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Script failed:', error)
    process.exit(1)
  }) 