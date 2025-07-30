#!/usr/bin/env node

/**
 * Debug script to check the staging metadata of a specific payment record
 * 
 * Usage: node scripts/debug/check-payment-staging-metadata.js <payment_id>
 * 
 * This script will:
 * 1. Query the xero_payments table for a specific payment record
 * 2. Display the staging_metadata and other relevant fields
 * 3. Help debug why charge IDs or payment intent IDs might be missing
 * 
 * Example: node scripts/debug/check-payment-staging-metadata.js c39e0be7-6cb0-4d0c-af24-bed859cc0fa3
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

async function checkPaymentStagingMetadata(paymentId) {
  if (!paymentId) {
    console.error('❌ Please provide a payment ID as an argument')
    console.log('Usage: node scripts/debug/check-payment-staging-metadata.js <payment_id>')
    process.exit(1)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  console.log(`🔍 Checking staging metadata for payment: ${paymentId}`)
  console.log('')

  try {
    // Get the payment record
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('xero_payments')
      .select('*')
      .eq('id', paymentId)
      .single()

    if (paymentError) {
      console.error('❌ Error fetching payment record:', paymentError)
      return
    }

    if (!paymentRecord) {
      console.error('❌ Payment record not found')
      return
    }

    console.log('📊 Payment Record Details:')
    console.log('========================')
    console.log(`ID: ${paymentRecord.id}`)
    console.log(`Xero Invoice ID: ${paymentRecord.xero_invoice_id}`)
    console.log(`Amount Paid: $${(paymentRecord.amount_paid / 100).toFixed(2)}`)
    console.log(`Reference: "${paymentRecord.reference}"`)
    console.log(`Sync Status: ${paymentRecord.sync_status}`)
    console.log(`Bank Account Code: ${paymentRecord.bank_account_code}`)
    console.log(`Created At: ${paymentRecord.created_at}`)
    console.log(`Updated At: ${paymentRecord.updated_at}`)
    console.log('')

    console.log('📋 Staging Metadata:')
    console.log('===================')
    if (paymentRecord.staging_metadata) {
      console.log(JSON.stringify(paymentRecord.staging_metadata, null, 2))
    } else {
      console.log('❌ No staging metadata found')
    }
    console.log('')

    // Check if we can find the charge ID in the staging metadata
    if (paymentRecord.staging_metadata) {
      const metadata = paymentRecord.staging_metadata
      console.log('🔍 Metadata Analysis:')
      console.log('====================')
      console.log(`Payment Intent ID: ${metadata.stripe_payment_intent_id || '❌ Not found'}`)
      console.log(`Charge ID: ${metadata.stripe_charge_id || '❌ Not found'}`)
      console.log(`Payment ID: ${metadata.payment_id || '❌ Not found'}`)
      console.log('')

      // Check the corresponding payment record in the payments table
      if (metadata.payment_id) {
        console.log('🔍 Checking corresponding payment record...')
        const { data: payment, error: paymentError } = await supabase
          .from('payments')
          .select('stripe_payment_intent_id, stripe_charge_id, status, completed_at')
          .eq('id', metadata.payment_id)
          .single()

        if (paymentError) {
          console.error('❌ Error fetching payment:', paymentError)
        } else if (payment) {
          console.log('📊 Payment Table Record:')
          console.log(`Stripe Payment Intent ID: ${payment.stripe_payment_intent_id || '❌ Not found'}`)
          console.log(`Stripe Charge ID: ${payment.stripe_charge_id || '❌ Not found'}`)
          console.log(`Status: ${payment.status}`)
          console.log(`Completed At: ${payment.completed_at}`)
        } else {
          console.log('❌ Payment record not found in payments table')
        }
      }
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error)
  }
}

// Get payment ID from command line arguments
const paymentId = process.argv[2]

checkPaymentStagingMetadata(paymentId)
  .then(() => {
    console.log('✅ Check completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Script failed:', error)
    process.exit(1)
  }) 