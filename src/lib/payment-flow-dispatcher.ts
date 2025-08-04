export interface PaymentFlowData {
  // Common fields
  amount: number // Final amount in cents
  
  // For memberships
  membershipId?: string
  durationMonths?: number
  paymentOption?: 'assistance' | 'donation' | 'standard'
  assistanceAmount?: number
  donationAmount?: number
  
  // For registrations
  registrationId?: string
  categoryId?: string
  presaleCode?: string
  discountCode?: string
}

export interface PaymentFlowResult {
  success: boolean
  isFree?: boolean
  clientSecret?: string
  paymentIntentId?: string
  message?: string
  error?: string
  invoiceNumber?: string
  xeroInvoiceId?: string
}

export async function handlePaymentFlow(
  paymentData: PaymentFlowData
): Promise<PaymentFlowResult> {
  try {
    if (paymentData.amount === 0) {
      // Zero payment: Use existing free payment APIs (they handle invoice creation)
      return await handleZeroPaymentFlow(paymentData)
    } else {
      // Paid purchase: Create payment intent and return for payment form
      return await handlePaidPaymentFlow(paymentData)
    }
  } catch (error) {
    console.error('Error in payment flow dispatcher:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function handleZeroPaymentFlow(
  paymentData: PaymentFlowData
): Promise<PaymentFlowResult> {
  const isRegistration = !!(paymentData.registrationId && paymentData.categoryId)
  
  try {
    // Use existing free payment APIs which will handle invoice creation
    const endpoint = isRegistration 
      ? '/api/create-registration-payment-intent'
      : '/api/create-membership-payment-intent'
    
    const body = isRegistration
      ? {
          registrationId: paymentData.registrationId,
          categoryId: paymentData.categoryId,
          amount: 0,
          presaleCode: paymentData.presaleCode,
          discountCode: paymentData.discountCode
        }
      : {
          membershipId: paymentData.membershipId,
          durationMonths: paymentData.durationMonths,
          amount: 0,
          paymentOption: paymentData.paymentOption,
          assistanceAmount: paymentData.assistanceAmount,
          donationAmount: paymentData.donationAmount
        }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to complete free purchase')
    }

    const responseData = await response.json()
    
    return {
      success: true,
      isFree: true,
      message: responseData.message || (isRegistration 
        ? 'Free registration completed successfully' 
        : 'Free membership activated successfully'),
      invoiceNumber: responseData.invoiceNumber,
      xeroInvoiceId: responseData.xeroInvoiceId
    }
  } catch (error) {
    console.error('Error in zero payment flow:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to complete free purchase'
    }
  }
}

async function handlePaidPaymentFlow(
  paymentData: PaymentFlowData
): Promise<PaymentFlowResult> {
  const isRegistration = !!(paymentData.registrationId && paymentData.categoryId)
  
  try {
    // Create payment intent
    const endpoint = isRegistration 
      ? '/api/create-registration-payment-intent'
      : '/api/create-membership-payment-intent'
    
    const body = isRegistration
      ? {
          registrationId: paymentData.registrationId,
          categoryId: paymentData.categoryId,
          amount: paymentData.amount,
          presaleCode: paymentData.presaleCode,
          discountCode: paymentData.discountCode
        }
      : {
          membershipId: paymentData.membershipId,
          durationMonths: paymentData.durationMonths,
          amount: paymentData.amount,
          paymentOption: paymentData.paymentOption,
          assistanceAmount: paymentData.assistanceAmount,
          donationAmount: paymentData.donationAmount
        }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to create payment intent')
    }

    const responseData = await response.json()
    
    return {
      success: true,
      clientSecret: responseData.clientSecret,
      paymentIntentId: responseData.paymentIntentId
    }
  } catch (error) {
    console.error('Error in paid payment flow:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create payment intent'
    }
  }
}