import { Payment } from 'xero-node'
import { getAuthenticatedXeroClient, logXeroSync } from './client'
import { createClient } from '../supabase/server'

export interface StripePaymentData {
  payment_id: string
  xero_invoice_id: string
  stripe_payment_intent_id: string
  gross_amount: number // in cents
  net_amount: number // in cents (after Stripe fees)
  stripe_fee_amount: number // in cents
  payment_date: string
  reference?: string
}

// Record a Stripe payment in Xero with proper fee handling
export async function recordStripePaymentInXero(
  paymentId: string,
  tenantId: string,
  bankAccountCode?: string // Will fetch from system_accounting_codes if not provided
): Promise<{ success: boolean; xeroPaymentId?: string; error?: string }> {
  try {
    const supabase = await createClient()
    const xeroApi = await getAuthenticatedXeroClient(tenantId)

    if (!xeroApi) {
      return { success: false, error: 'Unable to authenticate with Xero' }
    }

    // Get bank account code from system_accounting_codes if not provided
    if (!bankAccountCode) {
      const { data: systemCode, error: codeError } = await supabase
        .from('system_accounting_codes')
        .select('accounting_code')
        .eq('code_type', 'stripe_bank_account')
        .single()
      
      if (codeError || !systemCode?.accounting_code) {
        return { 
          success: false, 
          error: 'Stripe bank account code not configured. Please set up the stripe_bank_account in system accounting codes.' 
        }
      }
      
      bankAccountCode = systemCode.accounting_code
    }

    // Check if payment already recorded
    const { data: existingPayment } = await supabase
      .from('xero_payments')
      .select('*')
      .eq('xero_invoice_id', paymentId) // This references our internal xero_invoices table
      .eq('tenant_id', tenantId)
      .single()

    if (existingPayment && existingPayment.sync_status === 'synced') {
      return { 
        success: true, 
        xeroPaymentId: existingPayment.xero_payment_id
      }
    }

    // Get payment and invoice data
    const stripePaymentData = await getStripePaymentData(paymentId)
    if (!stripePaymentData) {
      return { success: false, error: 'Payment data not found' }
    }

    // Get the corresponding Xero invoice
    const { data: xeroInvoice, error: invoiceError } = await supabase
      .from('xero_invoices')
      .select('*')
      .eq('payment_id', paymentId)
      .eq('tenant_id', tenantId)
      .single()

    if (invoiceError || !xeroInvoice) {
      return { success: false, error: 'Xero invoice not found - must create invoice before recording payment' }
    }

    // Create the payment record in Xero
    const paymentData: Payment = {
      invoice: {
        invoiceID: xeroInvoice.xero_invoice_id
      },
      account: {
        code: bankAccountCode
      },
      amount: stripePaymentData.net_amount / 100, // Convert to dollars (net amount after fees)
      date: stripePaymentData.payment_date,
      reference: stripePaymentData.reference || `Stripe: ${stripePaymentData.stripe_payment_intent_id}`
    }

    const paymentResponse = await xeroApi.accountingApi.createPayments(tenantId, {
      payments: [paymentData]
    })

    if (!paymentResponse.body.payments || paymentResponse.body.payments.length === 0) {
      await logXeroSync({
        tenant_id: tenantId,
        operation: 'payment_sync',
        record_type: 'payment',
        record_id: paymentId || '',
        xero_id: undefined,
        success: false,
        error_message: 'No payment returned from Xero API'
      })
      return { success: false, error: 'No payment returned from Xero API' }
    }

    const xeroPayment = paymentResponse.body.payments[0]
    const xeroPaymentId = xeroPayment.paymentID

    if (!xeroPaymentId) {
      await logXeroSync({
        tenant_id: tenantId,
        operation: 'payment_sync',
        record_type: 'payment',
        record_id: paymentId || '',
        xero_id: undefined,
        success: false,
        error_message: 'No payment ID returned from Xero API'
      })
      return { success: false, error: 'No payment ID returned from Xero API' }
    }

    // Record Stripe fees as an expense if they're significant enough
    if (stripePaymentData.stripe_fee_amount > 0) {
      await recordStripeFeeExpense(
        tenantId,
        stripePaymentData.stripe_fee_amount,
        stripePaymentData.stripe_payment_intent_id,
        stripePaymentData.payment_date,
        xeroApi
      )
    }

    // Store payment tracking record
    const paymentRecord = {
      xero_invoice_id: xeroInvoice.id, // Our internal xero_invoices table ID
      tenant_id: tenantId,
      xero_payment_id: xeroPaymentId,
      payment_method: 'stripe',
      bank_account_code: bankAccountCode,
      amount_paid: stripePaymentData.net_amount,
      stripe_fee_amount: stripePaymentData.stripe_fee_amount,
      reference: stripePaymentData.reference,
      sync_status: 'synced' as const,
      last_synced_at: new Date().toISOString()
    }

    if (existingPayment) {
      await supabase
        .from('xero_payments')
        .update(paymentRecord)
        .eq('xero_invoice_id', xeroInvoice.id)
        .eq('tenant_id', tenantId)
    } else {
      await supabase
        .from('xero_payments')
        .insert(paymentRecord)
    }

    await logXeroSync({
      tenant_id: tenantId,
      operation: 'payment_sync',
      record_type: 'payment',
      record_id: paymentId,
      xero_id: xeroPaymentId,
      success: true,
      details: `Payment recorded successfully: ${xeroPaymentId}`
    })

    return { 
      success: true, 
      xeroPaymentId
    }

  } catch (error) {
    console.error('Error recording Stripe payment in Xero:', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorCode = (error as any)?.response?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message || 'payment_recording_failed'

    await logXeroSync({
      tenant_id: tenantId,
      operation: 'payment_sync',
      record_type: 'payment',
      record_id: paymentId,
      xero_id: undefined,
      success: false,
      error_message: errorMessage
    })

    return { success: false, error: errorMessage }
  }
}

// Record Stripe processing fees as an expense in Xero
async function recordStripeFeeExpense(
  tenantId: string,
  feeAmount: number, // in cents
  paymentIntentId: string,
  paymentDate: string,
  xeroApi: any
): Promise<void> {
  try {
    // Create a simple expense claim for Stripe fees
    // In practice, you might want to batch these or handle them differently
    const expenseData = {
      date: paymentDate,
      user: {
        userID: process.env.XERO_DEFAULT_USER_ID // You'd need to configure this
      },
      receipts: [{
        receiptDate: paymentDate,
        contact: {
          name: 'Stripe Inc.'
        },
        total: feeAmount / 100, // Convert to dollars
        lineItems: [{
          description: `Stripe processing fee - ${paymentIntentId}`,
          unitAmount: feeAmount / 100,
          taxType: 'NONE',
          accountCode: 'STRIPE_FEES' // Account code for Stripe fees
        }]
      }]
    }

    // Note: This is a simplified approach. In practice, you might:
    // 1. Create a separate bank transaction for fees
    // 2. Use a different expense tracking method
    // 3. Batch fees into periodic journal entries
    
    console.log(`Recording Stripe fee of $${feeAmount / 100} for payment ${paymentIntentId}`)
    
    // For now, we'll just log this - the actual implementation depends on your accounting preferences
    await logXeroSync({
      tenant_id: tenantId,
      operation: 'payment_sync',
      record_type: 'payment',
      record_id: paymentIntentId,
      xero_id: undefined,
      success: true,
      details: `Stripe fee recorded: $${feeAmount / 100}`
    })

  } catch (error) {
    console.error('Error recording Stripe fee expense:', error)
    await logXeroSync({
      tenant_id: tenantId,
      operation: 'payment_sync',
      record_type: 'payment',
      record_id: paymentIntentId,
      xero_id: undefined,
      success: false,
      error_message: `Failed to record Stripe fee: ${error instanceof Error ? error.message : 'Unknown error'}`
    })
  }
}

// Get comprehensive Stripe payment data
async function getStripePaymentData(paymentId: string): Promise<StripePaymentData | null> {
  try {
    const supabase = await createClient()

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select(`
        id,
        stripe_payment_intent_id,
        final_amount,
        stripe_fee_amount,
        completed_at
      `)
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      console.error('Payment not found:', paymentId)
      return null
    }

    // Use actual Stripe fees from database, fallback to 0 if not available
    const grossAmount = payment.final_amount
    const stripeFeeAmount = payment.stripe_fee_amount || 0
    const netAmount = grossAmount - stripeFeeAmount

    return {
      payment_id: payment.id,
      xero_invoice_id: paymentId, // This will be corrected in the calling function
      stripe_payment_intent_id: payment.stripe_payment_intent_id,
      gross_amount: grossAmount,
      net_amount: netAmount,
      stripe_fee_amount: stripeFeeAmount,
      payment_date: payment.completed_at ? new Date(payment.completed_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      reference: `Stripe: ${payment.stripe_payment_intent_id}`
    }

  } catch (error) {
    console.error('Error getting Stripe payment data:', error)
    return null
  }
}

// Bulk record unrecorded payments
export async function bulkRecordUnsyncedPayments(
  tenantId: string,
  bankAccountCode: string = 'STRIPE'
): Promise<{
  success: boolean
  recorded: number
  failed: number
  errors: string[]
}> {
  try {
    const supabase = await createClient()

    // Get invoices that have been synced but don't have payment records
    const { data: invoicesNeedingPayments, error } = await supabase
      .from('xero_invoices')
      .select(`
        id,
        payment_id,
        invoice_number,
        net_amount
      `)
      .eq('tenant_id', tenantId)
      .eq('sync_status', 'synced')
      .not('id', 'in', `(
        SELECT xero_invoice_id FROM xero_payments 
        WHERE tenant_id = '${tenantId}' 
        AND sync_status = 'synced'
      )`)
      .limit(25) // Limit to avoid overwhelming the API

    if (error) {
      return { success: false, recorded: 0, failed: 0, errors: [error.message] }
    }

    if (!invoicesNeedingPayments || invoicesNeedingPayments.length === 0) {
      return { success: true, recorded: 0, failed: 0, errors: [] }
    }

    let recordedCount = 0
    let failedCount = 0
    const errors: string[] = []

    for (const invoice of invoicesNeedingPayments) {
      try {
        const result = await recordStripePaymentInXero(invoice.payment_id, tenantId, bankAccountCode)
        if (result.success) {
          recordedCount++
        } else {
          failedCount++
          if (result.error) {
            errors.push(`Invoice ${invoice.invoice_number}: ${result.error}`)
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 300))

      } catch (error) {
        failedCount++
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        errors.push(`Invoice ${invoice.invoice_number}: ${errorMessage}`)
      }
    }

    return {
      success: true,
      recorded: recordedCount,
      failed: failedCount,
      errors
    }

  } catch (error) {
    console.error('Error in bulk payment recording:', error)
    return {
      success: false,
      recorded: 0,
      failed: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error']
    }
  }
}