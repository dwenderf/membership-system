import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logging/logger'

// Import staging function for credit note creation
async function stageCreditNoteForXero(supabase: any, refundId: string, paymentId: string, refundAmount: number): Promise<boolean> {
  try {
    console.log(`🔄 Staging credit note for refund ${refundId}`)
    
    // Get payment details for staging metadata
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select(`
        *,
        users!payments_user_id_fkey (
          id,
          first_name,
          last_name,
          member_id,
          email
        )
      `)
      .eq('id', paymentId)
      .single()
    
    if (paymentError || !payment) {
      console.error(`❌ Failed to get payment details for staging: ${paymentError?.message}`)
      return false
    }
    
    // Get original invoice line items to build credit note line items
    const { data: originalInvoice, error: invoiceError } = await supabase
      .from('xero_invoices')
      .select(`
        *,
        xero_invoice_line_items (
          description,
          line_amount,
          account_code,
          tax_type,
          line_item_type
        )
      `)
      .eq('payment_id', paymentId)
      .single()
    
    let lineItems = []
    if (originalInvoice?.xero_invoice_line_items) {
      // Proportionally allocate refund across original line items
      const totalInvoiceAmount = originalInvoice.xero_invoice_line_items.reduce((sum: number, item: any) => sum + item.line_amount, 0)
      
      lineItems = originalInvoice.xero_invoice_line_items.map((item: any) => {
        const proportion = Math.abs(item.line_amount) / totalInvoiceAmount
        const creditAmount = Math.round(refundAmount * proportion)
        
        return {
          description: `Credit: ${item.description}`,
          line_amount: creditAmount, // Positive amount for credit note
          account_code: item.account_code,
          tax_type: item.tax_type,
          line_item_type: item.line_item_type
        }
      })
      
      // Ensure total matches refund amount exactly (handle rounding)
      const calculatedTotal = lineItems.reduce((sum, item) => sum + item.line_amount, 0)
      const difference = refundAmount - calculatedTotal
      if (difference !== 0 && lineItems.length > 0) {
        lineItems[0].line_amount += difference // Adjust first item for rounding
      }
    } else {
      // Fallback: Create a single line item for the full refund amount
      lineItems = [{
        description: 'Refund',
        line_amount: refundAmount,
        account_code: '200', // Default revenue account
        tax_type: 'OUTPUT',
        line_item_type: 'refund'
      }]
    }
    
    // Create staging record in xero_invoices table
    const { data: stagingRecord, error: stagingError } = await supabase
      .from('xero_invoices')
      .insert({
        payment_id: paymentId,
        invoice_type: 'ACCRECCREDIT', // Credit note type
        invoice_status: 'DRAFT', // Will be created as draft in Xero
        total_amount: refundAmount,
        net_amount: refundAmount,
        sync_status: 'pending', // Ready for sync
        staged_at: new Date().toISOString(),
        staging_metadata: {
          refund_id: refundId,
          customer: {
            id: payment.users.id,
            name: `${payment.users.first_name} ${payment.users.last_name}`,
            email: payment.users.email,
            member_id: payment.users.member_id
          },
          refund_type: 'admin_refund',
          refund_amount: refundAmount,
          original_payment_id: paymentId
        }
      })
      .select()
      .single()
    
    if (stagingError) {
      console.error(`❌ Failed to create credit note staging record: ${stagingError.message}`)
      return false
    }
    
    // Create line items for the credit note
    if (lineItems.length > 0) {
      const { error: lineItemsError } = await supabase
        .from('xero_invoice_line_items')
        .insert(
          lineItems.map((item, index) => ({
            xero_invoice_id: stagingRecord.id,
            description: item.description,
            quantity: 1,
            unit_amount: Math.abs(item.line_amount) / 100, // Convert to dollars, ensure positive for credit
            line_amount: item.line_amount,
            account_code: item.account_code,
            tax_type: item.tax_type,
            line_item_type: item.line_item_type
          }))
        )
      
      if (lineItemsError) {
        console.error(`❌ Failed to create credit note line items: ${lineItemsError.message}`)
        // Clean up the staging record if line items failed
        await supabase
          .from('xero_invoices')
          .delete()
          .eq('id', stagingRecord.id)
        return false
      }
    }
    
    console.log(`✅ Created credit note staging record ${stagingRecord.id} for refund ${refundId}`)
    
    // Get Stripe bank account code for payment staging
    const { data: stripeAccountCode, error: accountError } = await supabase
      .from('system_accounting_codes')
      .select('accounting_code')
      .eq('code_type', 'stripe_bank_account')
      .single()
    
    const bankAccountCode = stripeAccountCode?.accounting_code || '090' // Fallback
    
    if (accountError || !stripeAccountCode?.accounting_code) {
      console.warn(`⚠️ Using fallback bank account code (090) for credit note payment. Error: ${accountError?.message}`)
    }
    
    // Create corresponding payment record for the refund (negative amount = money going out)
    const { data: paymentStaging, error: paymentStagingError } = await supabase
      .from('xero_payments')
      .insert({
        xero_invoice_id: stagingRecord.id, // Links to the credit note record
        tenant_id: null, // Will be populated during sync
        xero_payment_id: null, // Will be populated when synced to Xero
        payment_method: 'stripe',
        bank_account_code: bankAccountCode,
        amount_paid: -Math.abs(refundAmount), // Negative amount = money going OUT
        stripe_fee_amount: 0, // Refunds don't have additional Stripe fees
        reference: `Refund ${refundId.slice(0, 8)}`,
        sync_status: 'pending', // Ready for sync (refund is confirmed by webhook)
        staged_at: new Date().toISOString(),
        staging_metadata: {
          refund_id: refundId,
          payment_id: paymentId,
          refund_type: 'admin_refund',
          refund_amount: refundAmount,
          credit_note_id: stagingRecord.id
        }
      })
      .select()
      .single()
    
    if (paymentStagingError) {
      console.error(`❌ Failed to create credit note payment staging record: ${paymentStagingError.message}`)
      // Clean up the credit note staging record if payment failed
      await supabase
        .from('xero_invoices')
        .delete()
        .eq('id', stagingRecord.id)
      return false
    }
    
    console.log(`✅ Created credit note payment staging record ${paymentStaging.id} for refund ${refundId}`)
    return true
    
  } catch (error) {
    console.error(`❌ Error staging credit note for refund ${refundId}:`, error)
    return false
  }
}

// PUT /api/admin/refunds/[refundId] - Update refund status or sync to Xero
export async function PUT(
  request: NextRequest,
  { params }: { params: { refundId: string } }
) {
  const supabase = await createClient()
  const logger = Logger.getInstance()

  try {
    // Check if current user is admin
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

    // Parse request body
    const body = await request.json()
    const { action } = body

    // Validate refund exists
    const { data: refund, error: refundError } = await supabase
      .from('refunds')
      .select('*')
      .eq('id', params.refundId)
      .single()

    if (refundError || !refund) {
      logger.logSystem('refund-update-error', 'Refund not found', { 
        refundId: params.refundId,
        error: refundError?.message 
      })
      return NextResponse.json({ error: 'Refund not found' }, { status: 404 })
    }

    if (action === 'sync_xero') {
      // Manually trigger staging for this refund's credit note
      try {
        const stagingSuccess = await stageCreditNoteForXero(supabase, params.refundId, refund.payment_id, refund.amount)
        
        if (stagingSuccess) {
          logger.logSystem('refund-xero-staging-manual', 'Manual credit note staging completed', {
            refundId: params.refundId,
            triggeredBy: authUser.id
          })

          return NextResponse.json({
            success: true,
            message: 'Credit note staging completed successfully. It will be synced to Xero during the next batch sync.'
          })
        } else {
          throw new Error('Failed to create staging record')
        }

      } catch (stagingError) {
        logger.logSystem('refund-xero-staging-manual-error', 'Manual credit note staging failed', {
          refundId: params.refundId,
          triggeredBy: authUser.id,
          error: stagingError instanceof Error ? stagingError.message : 'Unknown error'
        })

        return NextResponse.json({
          error: 'Failed to stage credit note: ' + (stagingError instanceof Error ? stagingError.message : 'Unknown error')
        }, { status: 500 })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  } catch (error) {
    logger.logSystem('refund-update-error', 'Unexpected error updating refund', { 
      refundId: params.refundId,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}