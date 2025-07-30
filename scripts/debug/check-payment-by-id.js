#!/usr/bin/env node

/**
 * Debug script to check if a payment exists by ID
 * 
 * Usage: node scripts/debug/check-payment-by-id.js <payment_id>
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

async function checkPaymentById(paymentId) {
  if (!paymentId) {
    console.error('❌ Please provide a payment ID as an argument')
    console.log('Usage: node scripts/debug/check-payment-by-id.js <payment_id>')
    process.exit(1)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  console.log(`🔍 Checking payment: ${paymentId}`)
  console.log('')

  try {
    // Check payments table
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
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

    // Check xero_payments table
    const { data: xeroPayment, error: xeroError } = await supabase
      .from('xero_payments')
      .select('*')
      .eq('id', paymentId)
      .single()

    if (xeroError) {
      console.error('❌ Error fetching Xero payment:', xeroError)
    } else if (xeroPayment) {
      console.log('✅ Payment found in xero_payments table:')
      console.log(JSON.stringify(xeroPayment, null, 2))
    } else {
      console.log('❌ Payment not found in xero_payments table')
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error)
  }
}

// Get payment ID from command line arguments
const paymentId = process.argv[2]

checkPaymentById(paymentId)
  .then(() => {
    console.log('✅ Check completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Script failed:', error)
    process.exit(1)
  }) 