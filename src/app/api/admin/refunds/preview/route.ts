import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { xeroStagingManager } from '@/lib/xero/staging'
import { centsToCents } from '@/types/currency'

// POST /api/admin/refunds/preview - Preview refund line items and amounts
export async function POST(request: NextRequest) {
  const supabase = await createClient()

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
    const { paymentId, refundType, amount, discountValidation } = body

    // Validate required fields
    if (!paymentId || !refundType) {
      return NextResponse.json({ 
        error: 'Payment ID and refund type are required' 
      }, { status: 400 })
    }

    // Get payment details for validation
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Validate payment status
    if (payment.status !== 'completed') {
      return NextResponse.json({ 
        error: 'Can only refund completed payments' 
      }, { status: 400 })
    }

    // Check available refund amount
    const { data: existingRefunds } = await supabase
      .from('refunds')
      .select('amount')
      .eq('payment_id', paymentId)
      .in('status', ['completed', 'processing', 'pending'])

    const totalExistingRefunds = existingRefunds?.reduce((sum, refund) => sum + refund.amount, 0) || 0
    const availableForRefund = payment.final_amount - totalExistingRefunds

    let refundData

    if (refundType === 'proportional') {
      if (!amount || amount <= 0) {
        return NextResponse.json({ 
          error: 'Positive refund amount required for proportional refunds' 
        }, { status: 400 })
      }

      const amountInCents = Math.round(amount * 100)
      
      if (amountInCents > availableForRefund) {
        return NextResponse.json({ 
          error: `Cannot refund $${amount.toFixed(2)}. Only $${(availableForRefund / 100).toFixed(2)} available.` 
        }, { status: 400 })
      }

      refundData = {
        amount: centsToCents(amountInCents)
      }

    } else if (refundType === 'discount_code') {
      if (!discountValidation?.isValid) {
        return NextResponse.json({ 
          error: 'Valid discount code validation required' 
        }, { status: 400 })
      }

      const discountAmount = discountValidation.discountAmount || 0
      
      if (discountAmount > availableForRefund) {
        return NextResponse.json({ 
          error: `Discount amount $${(discountAmount / 100).toFixed(2)} exceeds available refund amount $${(availableForRefund / 100).toFixed(2)}` 
        }, { status: 400 })
      }

      refundData = {
        discountCode: discountValidation.discountCode.code,
        discountAmount: centsToCents(discountAmount),
        discountAccountingCode: discountValidation.discountCode.category.accounting_code,
        discountCategoryName: discountValidation.discountCode.category.name
      }

    } else {
      return NextResponse.json({ 
        error: 'Invalid refund type. Must be "proportional" or "discount_code"' 
      }, { status: 400 })
    }

    // Generate preview of refund staging without creating actual records
    // Use the xeroStagingManager preview method instead of creating real staging
    const previewResult = await xeroStagingManager.previewRefundStaging(
      paymentId,
      refundType,
      refundData
    )

    if (!previewResult.success) {
      return NextResponse.json({ 
        error: previewResult.error || 'Failed to generate refund preview' 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      preview: {
        refund_type: refundType,
        total_amount: previewResult.totalAmount || 0,
        line_items: previewResult.lineItems || [],
        payment_info: {
          payment_id: paymentId,
          original_amount: payment.final_amount,
          available_for_refund: availableForRefund
        },
        discount_info: refundType === 'discount_code' ? {
          code: discountValidation.discountCode.code,
          category: discountValidation.discountCode.category.name,
          percentage: discountValidation.discountCode.percentage,
          is_partial: discountValidation.isPartialDiscount || false,
          partial_message: discountValidation.partialDiscountMessage
        } : undefined
      }
    })

  } catch (error) {
    console.error('Error generating refund preview:', error)
    return NextResponse.json({ error: 'Failed to generate refund preview' }, { status: 500 })
  }
}