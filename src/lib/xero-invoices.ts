import { Invoice, LineItem, CurrencyCode, Contact, ContactPerson } from 'xero-node'
import { getAuthenticatedXeroClient, logXeroSync, getActiveTenant } from './xero-client'
import { getOrCreateXeroContact, syncUserToXeroContact } from './xero-contacts'
import { createClient } from './supabase/server'
import * as Sentry from '@sentry/nextjs'

export interface PaymentInvoiceData {
  payment_id: string
  user_id: string
  total_amount: number // in cents
  discount_amount: number // in cents
  final_amount: number // in cents
  payment_items: Array<{
    item_type: 'membership' | 'registration' | 'donation'
    item_id: string | null
    amount: number // in cents
    description?: string
    accounting_code?: string
  }>
  discount_codes_used?: Array<{
    code: string
    amount_saved: number // in cents
    category_name: string
    accounting_code?: string
  }>
  stripe_payment_intent_id?: string
}

export interface PrePaymentInvoiceData {
  user_id: string
  total_amount: number // in cents
  discount_amount?: number // in cents
  final_amount: number // in cents
  payment_items: Array<{
    item_type: 'membership' | 'registration' | 'donation'
    item_id: string | null
    amount: number // in cents
    description?: string
    accounting_code?: string
  }>
  discount_codes_used?: Array<{
    code: string
    amount_saved: number // in cents
    category_name: string
    accounting_code?: string
  }>
}

// Helper function to create a new contact when the existing one is archived
async function createNewContactForArchivedContact(
  userId: string, 
  tenantId: string
): Promise<{ success: boolean; xeroContactId?: string; error?: string }> {
  try {
    const supabase = await createClient()
    
    // Get user data including member_id
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, phone, member_id')
      .eq('id', userId)
      .single()

    if (userError || !userData) {
      return { success: false, error: 'User not found for archived contact workaround' }
    }

    // Force create a new contact with unique name to avoid archived contact
    console.log(`🔄 Creating new contact for user ${userId} to avoid archived contact`)
    
    const xeroApi = await getAuthenticatedXeroClient(tenantId)
    if (!xeroApi) {
      return { success: false, error: 'Unable to authenticate with Xero for new contact creation' }
    }

    // Create contact with member ID format for uniqueness
    let contactName = `${userData.first_name} ${userData.last_name}`
    if (userData.member_id) {
      contactName = `${userData.first_name} ${userData.last_name} - ${userData.member_id}`
    } else {
      // Fallback: add timestamp to ensure uniqueness
      const timestamp = Date.now().toString().slice(-6)
      contactName = `${userData.first_name} ${userData.last_name} - ${timestamp}`
    }

    const contactData: Contact = {
      name: contactName,
      firstName: userData.first_name,
      lastName: userData.last_name,
      emailAddress: userData.email,
      contactPersons: userData.phone ? [{
        firstName: userData.first_name,
        lastName: userData.last_name,
        emailAddress: userData.email,
        phoneNumber: userData.phone
      } as ContactPerson] : undefined
    }

    const response = await xeroApi.createContacts(tenantId, {
      contacts: [contactData]
    })

    if (!response.body.contacts || response.body.contacts.length === 0) {
      return { success: false, error: 'No contact returned from Xero API during new contact creation' }
    }

    const xeroContact = response.body.contacts[0]
    const xeroContactId = xeroContact.contactID

    if (!xeroContactId) {
      return { success: false, error: 'No contact ID returned from Xero API during new contact creation' }
    }

    console.log(`✅ Created new contact ${xeroContactId} with name "${contactName}" to avoid archived contact`)
    return { success: true, xeroContactId }
    
  } catch (error) {
    console.error('Error creating new contact for archived contact:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to create new contact' 
    }
  }
}

// Create an invoice in Xero BEFORE payment (for invoice-first flow)
export async function createXeroInvoiceBeforePayment(
  invoiceData: PrePaymentInvoiceData,
  options?: { markAsAuthorised?: boolean }
): Promise<{ success: boolean; xeroInvoiceId?: string; invoiceNumber?: string; error?: string }> {
  try {
    const activeTenant = await getActiveTenant()
    if (!activeTenant) {
      return { success: false, error: 'No active Xero tenant configured' }
    }

    const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
    if (!xeroApi) {
      return { success: false, error: 'Unable to authenticate with Xero' }
    }

    // Ensure contact exists in Xero
    const contactResult = await getOrCreateXeroContact(invoiceData.user_id, activeTenant.tenant_id)
    if (!contactResult.success || !contactResult.xeroContactId) {
      return { 
        success: false, 
        error: `Failed to sync contact: ${contactResult.error}` 
      }
    }

    // Build invoice line items
    const lineItems: LineItem[] = []

    // Add payment items (memberships, registrations, donations)
    for (const item of invoiceData.payment_items) {
      lineItems.push({
        description: item.description || getDefaultItemDescription(item),
        unitAmount: item.amount / 100, // Convert from cents to dollars
        quantity: 1,
        accountCode: item.accounting_code || getDefaultAccountCode(item.item_type),
        taxType: 'NONE' // Assuming no tax for now, can be configured
      })
    }

    // Add discount line items (negative amounts)
    if (invoiceData.discount_codes_used) {
      for (const discount of invoiceData.discount_codes_used) {
        lineItems.push({
          description: `Discount - ${discount.code} (${discount.category_name})`,
          unitAmount: -(discount.amount_saved / 100), // Negative amount for discount
          quantity: 1,
          accountCode: discount.accounting_code || 'DISCOUNT',
          taxType: 'NONE'
        })
      }
    }

    // Create the invoice
    const xeroInvoiceData: Invoice = {
      type: Invoice.TypeEnum.ACCREC, // Accounts Receivable
      contact: {
        contactID: contactResult.xeroContactId
      },
      status: options?.markAsAuthorised ? Invoice.StatusEnum.AUTHORISED : Invoice.StatusEnum.DRAFT,
      lineItems: lineItems,
      date: new Date().toISOString().split('T')[0], // Today's date
      dueDate: new Date().toISOString().split('T')[0], // Due today
      reference: options?.markAsAuthorised ? 'Fully Paid' : 'Pending Payment',
      currencyCode: CurrencyCode.USD // Configurable if needed
    }

    let response
    try {
      response = await xeroApi.createInvoices(activeTenant.tenant_id, {
        invoices: [xeroInvoiceData]
      })
    } catch (invoiceError: any) {
      // Check if the error is due to archived contact
      const errorMessage = invoiceError?.response?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message || ''
      if (errorMessage.includes('archived') || errorMessage.includes('un-archived')) {
        console.log(`⚠️ Contact ${contactResult.xeroContactId} is archived, creating new contact for invoice`)
        
        // Force create a new contact to avoid the archived one
        const newContactResult = await createNewContactForArchivedContact(invoiceData.user_id, activeTenant.tenant_id)
        if (!newContactResult.success || !newContactResult.xeroContactId) {
          throw invoiceError // Re-throw original error if we can't create new contact
        }
        
        // Update invoice data with new contact ID and retry
        xeroInvoiceData.contact = { contactID: newContactResult.xeroContactId }
        response = await xeroApi.createInvoices(activeTenant.tenant_id, {
          invoices: [xeroInvoiceData]
        })
      } else {
        throw invoiceError // Re-throw other errors
      }
    }

    if (!response.body.invoices || response.body.invoices.length === 0) {
      await logXeroSync(
        activeTenant.tenant_id,
        'invoice_sync',
        'payment',
        null,
        null,
        'error',
        'no_invoice_returned',
        'No invoice returned from Xero API during pre-payment creation'
      )
      return { success: false, error: 'No invoice returned from Xero API' }
    }

    const xeroInvoice = response.body.invoices[0]
    const xeroInvoiceId = xeroInvoice.invoiceID
    const invoiceNumber = xeroInvoice.invoiceNumber

    if (!xeroInvoiceId || !invoiceNumber) {
      await logXeroSync(
        activeTenant.tenant_id,
        'invoice_sync',
        'payment',
        null,
        null,
        'error',
        'no_invoice_id',
        'No invoice ID or number returned from Xero API during pre-payment creation'
      )
      return { success: false, error: 'No invoice ID or number returned from Xero API' }
    }

    // Store preliminary invoice record (will be updated when payment completes)
    const supabase = await createClient()
    const invoiceRecord = {
      payment_id: null, // Will be set when payment is created
      tenant_id: activeTenant.tenant_id,
      xero_invoice_id: xeroInvoiceId,
      invoice_number: invoiceNumber,
      invoice_type: 'ACCREC',
      invoice_status: xeroInvoice.status,
      total_amount: invoiceData.total_amount,
      discount_amount: invoiceData.discount_amount || 0,
      net_amount: invoiceData.final_amount,
      stripe_fee_amount: null, // Will be calculated after payment
      sync_status: 'draft' as const, // Mark as draft until payment completes
      last_synced_at: new Date().toISOString()
    }

    await supabase
      .from('xero_invoices')
      .insert(invoiceRecord)

    await logXeroSync(
      activeTenant.tenant_id,
      'invoice_sync',
      'payment',
      null,
      xeroInvoiceId,
      'success',
      undefined,
      `Pre-payment invoice created successfully: ${invoiceNumber}`
    )

    return { 
      success: true, 
      xeroInvoiceId, 
      invoiceNumber 
    }

  } catch (error) {
    console.error('Error creating Xero invoice before payment:', error)
    
    // Extract meaningful error message from Xero API response
    let errorMessage = 'Unknown error during pre-payment invoice creation'
    let errorCode = 'invoice_creation_failed'
    
    if (error instanceof Error) {
      errorMessage = error.message
    } else if (error && typeof error === 'object') {
      // Handle Xero API error structure
      const xeroError = error as any
      
      if (xeroError.response?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message) {
        errorMessage = `Xero validation error: ${xeroError.response.body.Elements[0].ValidationErrors[0].Message}`
        errorCode = 'xero_validation_error'
      } else if (xeroError.response?.body?.Message) {
        errorMessage = `Xero API error: ${xeroError.response.body.Message}`
        errorCode = 'xero_api_error'
      } else if (xeroError.message) {
        errorMessage = xeroError.message
      } else {
        errorMessage = `Xero error: ${JSON.stringify(xeroError).substring(0, 200)}...`
      }
    }
    
    // Capture critical invoice creation error in Sentry
    Sentry.withScope((scope) => {
      scope.setTag('integration', 'xero')
      scope.setTag('operation', 'invoice_creation')
      scope.setTag('error_code', errorCode)
      scope.setContext('xero_error', {
        user_id: invoiceData.user_id,
        total_amount: invoiceData.total_amount,
        final_amount: invoiceData.final_amount,
        payment_items_count: invoiceData.payment_items.length,
        error_code: errorCode,
        error_message: errorMessage,
        has_discount_codes: invoiceData.discount_codes_used && invoiceData.discount_codes_used.length > 0
      })
      
      if (error instanceof Error) {
        Sentry.captureException(error)
      } else {
        Sentry.captureMessage(`Critical Xero invoice creation failure: ${errorMessage}`, 'error')
      }
    })
    
    const activeTenant = await getActiveTenant()
    if (activeTenant) {
      await logXeroSync(
        activeTenant.tenant_id,
        'invoice_sync',
        'payment',
        null,
        null,
        'error',
        errorCode,
        errorMessage
      )
    }

    return { 
      success: false, 
      error: errorMessage
    }
  }
}

// Delete a draft invoice from Xero (for payment failures)
export async function deleteXeroDraftInvoice(
  xeroInvoiceId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const activeTenant = await getActiveTenant()
    if (!activeTenant) {
      return { success: false, error: 'No active Xero tenant configured' }
    }

    const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
    if (!xeroApi) {
      return { success: false, error: 'Unable to authenticate with Xero' }
    }

    // Delete the invoice from Xero
    await xeroApi.deleteInvoice(activeTenant.tenant_id, xeroInvoiceId)

    await logXeroSync(
      activeTenant.tenant_id,
      'invoice_sync',
      'payment',
      null,
      xeroInvoiceId,
      'success',
      undefined,
      `Draft invoice deleted after payment failure: ${xeroInvoiceId}`
    )

    return { success: true }

  } catch (error) {
    console.error('Error deleting Xero draft invoice:', error)
    
    const activeTenant = await getActiveTenant()
    if (activeTenant) {
      await logXeroSync(
        activeTenant.tenant_id,
        'invoice_sync',
        'payment',
        null,
        xeroInvoiceId,
        'error',
        'invoice_deletion_failed',
        error instanceof Error ? error.message : 'Unknown error during invoice deletion'
      )
    }

    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

// Create an invoice in Xero for a payment
export async function createXeroInvoiceForPayment(
  paymentId: string,
  tenantId: string
): Promise<{ success: boolean; xeroInvoiceId?: string; invoiceNumber?: string; error?: string }> {
  try {
    const supabase = await createClient()
    const xeroApi = await getAuthenticatedXeroClient(tenantId)

    if (!xeroApi) {
      return { success: false, error: 'Unable to authenticate with Xero' }
    }

    // Check if invoice already exists
    const { data: existingInvoice } = await supabase
      .from('xero_invoices')
      .select('*')
      .eq('payment_id', paymentId)
      .eq('tenant_id', tenantId)
      .single()

    if (existingInvoice && existingInvoice.sync_status === 'synced') {
      return { 
        success: true, 
        xeroInvoiceId: existingInvoice.xero_invoice_id,
        invoiceNumber: existingInvoice.invoice_number
      }
    }

    // Get comprehensive payment data
    const paymentData = await getPaymentInvoiceData(paymentId)
    if (!paymentData) {
      return { success: false, error: 'Payment data not found' }
    }

    // Ensure contact exists in Xero
    const contactResult = await getOrCreateXeroContact(paymentData.user_id, tenantId)
    if (!contactResult.success || !contactResult.xeroContactId) {
      return { 
        success: false, 
        error: `Failed to sync contact: ${contactResult.error}` 
      }
    }

    // Build invoice line items
    const lineItems: LineItem[] = []

    // Add payment items (memberships, registrations, donations)
    for (const item of paymentData.payment_items) {
      lineItems.push({
        description: item.description || getDefaultItemDescription(item),
        unitAmount: item.amount / 100, // Convert from cents to dollars
        quantity: 1,
        accountCode: item.accounting_code || getDefaultAccountCode(item.item_type),
        taxType: 'NONE' // Assuming no tax for now, can be configured
      })
    }

    // Add discount line items (negative amounts)
    if (paymentData.discount_codes_used) {
      for (const discount of paymentData.discount_codes_used) {
        lineItems.push({
          description: `Discount - ${discount.code} (${discount.category_name})`,
          unitAmount: -(discount.amount_saved / 100), // Negative amount for discount
          quantity: 1,
          accountCode: discount.accounting_code || 'DISCOUNT',
          taxType: 'NONE'
        })
      }
    }

    // Create the invoice
    const invoiceData: Invoice = {
      type: Invoice.TypeEnum.ACCREC, // Accounts Receivable
      contact: {
        contactID: contactResult.xeroContactId
      },
      status: Invoice.StatusEnum.AUTHORISED, // Automatically authorize since payment is already received
      lineItems: lineItems,
      date: new Date().toISOString().split('T')[0], // Today's date
      dueDate: new Date().toISOString().split('T')[0], // Due today since it's already paid
      reference: paymentData.stripe_payment_intent_id ? 
                 `Stripe: ${paymentData.stripe_payment_intent_id}` : 
                 `Payment: ${paymentId}`,
      currencyCode: CurrencyCode.USD // Configurable if needed
    }

    const response = await xeroApi.createInvoices(tenantId, {
      invoices: [invoiceData]
    })

    if (!response.body.invoices || response.body.invoices.length === 0) {
      await logXeroSync(
        tenantId,
        'invoice_sync',
        'payment',
        paymentId,
        null,
        'error',
        'no_invoice_returned',
        'No invoice returned from Xero API'
      )
      return { success: false, error: 'No invoice returned from Xero API' }
    }

    const xeroInvoice = response.body.invoices[0]
    const xeroInvoiceId = xeroInvoice.invoiceID
    const invoiceNumber = xeroInvoice.invoiceNumber

    if (!xeroInvoiceId || !invoiceNumber) {
      await logXeroSync(
        tenantId,
        'invoice_sync',
        'payment',
        paymentId,
        null,
        'error',
        'no_invoice_id',
        'No invoice ID or number returned from Xero API'
      )
      return { success: false, error: 'No invoice ID or number returned from Xero API' }
    }

    // Calculate Stripe fees (typically 2.9% + $0.30)
    const stripeFeeAmount = Math.round(paymentData.final_amount * 0.029 + 30) // Approximate calculation

    // Store invoice tracking record
    const invoiceRecord = {
      payment_id: paymentId,
      tenant_id: tenantId,
      xero_invoice_id: xeroInvoiceId,
      invoice_number: invoiceNumber,
      invoice_type: 'ACCREC',
      invoice_status: xeroInvoice.status,
      total_amount: paymentData.total_amount,
      discount_amount: paymentData.discount_amount,
      net_amount: paymentData.final_amount,
      stripe_fee_amount: stripeFeeAmount,
      sync_status: 'synced' as const,
      last_synced_at: new Date().toISOString()
    }

    if (existingInvoice) {
      await supabase
        .from('xero_invoices')
        .update(invoiceRecord)
        .eq('payment_id', paymentId)
        .eq('tenant_id', tenantId)
    } else {
      await supabase
        .from('xero_invoices')
        .insert(invoiceRecord)
    }

    // Store line items for detailed tracking
    const lineItemRecords = lineItems.map((item, index) => ({
      xero_invoice_id: xeroInvoiceId, // Will need to get the ID from our xero_invoices table
      line_item_type: paymentData.payment_items[index]?.item_type || 'discount',
      item_id: paymentData.payment_items[index]?.item_id,
      description: item.description!,
      quantity: item.quantity!,
      unit_amount: Math.round((item.unitAmount! || 0) * 100), // Convert back to cents
      account_code: item.accountCode,
      tax_type: item.taxType,
      line_amount: Math.round((item.unitAmount! || 0) * (item.quantity! || 1) * 100)
    }))

    // Get our internal invoice record ID for line items
    const { data: internalInvoice } = await supabase
      .from('xero_invoices')
      .select('id')
      .eq('payment_id', paymentId)
      .eq('tenant_id', tenantId)
      .single()

    if (internalInvoice) {
      await supabase
        .from('xero_invoice_line_items')
        .insert(
          lineItemRecords.map(item => ({
            ...item,
            xero_invoice_id: internalInvoice.id
          }))
        )
    }

    // Mark payment as synced
    await supabase
      .from('payments')
      .update({
        xero_synced: true,
        xero_sync_error: null
      })
      .eq('id', paymentId)

    await logXeroSync(
      tenantId,
      'invoice_sync',
      'payment',
      paymentId,
      xeroInvoiceId,
      'success',
      undefined,
      `Invoice created successfully: ${invoiceNumber}`
    )

    return { 
      success: true, 
      xeroInvoiceId,
      invoiceNumber
    }

  } catch (error) {
    console.error('Error creating Xero invoice:', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorCode = (error as any)?.response?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message || 'invoice_creation_failed'

    // Update sync status
    const supabase = await createClient()
    await supabase
      .from('payments')
      .update({
        xero_synced: false,
        xero_sync_error: errorMessage
      })
      .eq('id', paymentId)

    await logXeroSync(
      tenantId,
      'invoice_sync',
      'payment',
      paymentId,
      null,
      'error',
      errorCode,
      errorMessage
    )

    return { success: false, error: errorMessage }
  }
}

// Get comprehensive payment data for invoice creation
async function getPaymentInvoiceData(paymentId: string): Promise<PaymentInvoiceData | null> {
  try {
    const supabase = await createClient()

    // Get payment data
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select(`
        id,
        user_id,
        total_amount,
        discount_amount,
        final_amount,
        stripe_payment_intent_id,
        payment_items (
          item_type,
          item_id,
          amount
        )
      `)
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      console.error('Payment not found:', paymentId)
      return null
    }

    // Enhance payment items with descriptions and accounting codes
    const enhancedPaymentItems = await Promise.all(
      payment.payment_items.map(async (item: any) => {
        let description = ''
        let accounting_code = ''

        if (item.item_type === 'membership' && item.item_id) {
          const { data: membership } = await supabase
            .from('memberships')
            .select('name, accounting_code')
            .eq('id', item.item_id)
            .single()
          
          if (membership) {
            description = `Membership: ${membership.name}`
            accounting_code = membership.accounting_code
          }
        } else if (item.item_type === 'registration' && item.item_id) {
          const { data: registration } = await supabase
            .from('registrations')
            .select('name')
            .eq('id', item.item_id)
            .single()
          
          if (registration) {
            description = `Registration: ${registration.name}`
            // Registration accounting codes are on categories, would need more complex query
          }
        } else if (item.item_type === 'donation') {
          description = 'Community Support Donation'
          accounting_code = 'DONATION' // Default donation account code
        }

        return {
          ...item,
          description,
          accounting_code
        }
      })
    )

    // Get discount codes used (if any)
    const { data: discountUsage } = await supabase
      .from('discount_usage')
      .select(`
        amount_saved,
        discount_codes (
          code,
          discount_categories (
            name,
            accounting_code
          )
        )
      `)
      .eq('registration_id', paymentId) // This might need adjustment based on schema

    const discountCodesUsed = discountUsage?.map((usage: any) => ({
      code: usage.discount_codes.code,
      amount_saved: usage.amount_saved,
      category_name: usage.discount_codes.discount_categories.name,
      accounting_code: usage.discount_codes.discount_categories.accounting_code
    })) || []

    return {
      payment_id: payment.id,
      user_id: payment.user_id,
      total_amount: payment.total_amount,
      discount_amount: payment.discount_amount,
      final_amount: payment.final_amount,
      payment_items: enhancedPaymentItems,
      discount_codes_used: discountCodesUsed,
      stripe_payment_intent_id: payment.stripe_payment_intent_id
    }

  } catch (error) {
    console.error('Error getting payment invoice data:', error)
    return null
  }
}

// Helper functions
function getDefaultItemDescription(item: PaymentInvoiceData['payment_items'][0]): string {
  switch (item.item_type) {
    case 'membership':
      return 'Membership Purchase'
    case 'registration':
      return 'Event Registration'
    case 'donation':
      return 'Community Support Donation'
    default:
      return 'Purchase'
  }
}

function getDefaultAccountCode(itemType: string): string {
  switch (itemType) {
    case 'membership':
      return 'MEMBERSHIP'
    case 'registration':
      return 'REGISTRATION'
    case 'donation':
      return 'DONATION'
    default:
      return 'REVENUE'
  }
}

// Bulk sync unsynced invoices
export async function bulkSyncUnsyncedInvoices(tenantId: string): Promise<{
  success: boolean
  synced: number
  failed: number
  errors: string[]
}> {
  try {
    const supabase = await createClient()

    // Get payments that haven't been synced to Xero
    const { data: unsyncedPayments, error } = await supabase
      .from('payments')
      .select('id, stripe_payment_intent_id')
      .eq('status', 'completed')
      .eq('xero_synced', false)
      .limit(50) // Limit to avoid overwhelming the API

    if (error) {
      return { success: false, synced: 0, failed: 0, errors: [error.message] }
    }

    if (!unsyncedPayments || unsyncedPayments.length === 0) {
      return { success: true, synced: 0, failed: 0, errors: [] }
    }

    let syncedCount = 0
    let failedCount = 0
    const errors: string[] = []

    for (const payment of unsyncedPayments) {
      try {
        const result = await createXeroInvoiceForPayment(payment.id, tenantId)
        if (result.success) {
          syncedCount++
        } else {
          failedCount++
          if (result.error) {
            errors.push(`Payment ${payment.stripe_payment_intent_id || payment.id}: ${result.error}`)
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200))

      } catch (error) {
        failedCount++
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        errors.push(`Payment ${payment.stripe_payment_intent_id || payment.id}: ${errorMessage}`)
      }
    }

    return {
      success: true,
      synced: syncedCount,
      failed: failedCount,
      errors
    }

  } catch (error) {
    console.error('Error in bulk invoice sync:', error)
    return {
      success: false,
      synced: 0,
      failed: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error']
    }
  }
}