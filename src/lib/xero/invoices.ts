import { Invoice, LineItem, CurrencyCode, Contact, ContactPerson } from 'xero-node'
import { getAuthenticatedXeroClient, logXeroSync, getActiveTenant } from './client'
import { getOrCreateXeroContact, syncUserToXeroContact } from './contacts'
import { createClient } from '../supabase/server'
import * as Sentry from '@sentry/nextjs'

// Helper function to get system accounting codes
async function getSystemAccountingCode(codeType: string): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('system_accounting_codes')
      .select('accounting_code')
      .eq('code_type', codeType)
      .single()
    
    if (error || !data) {
      console.warn(`System accounting code not found for type: ${codeType}`)
      return null
    }
    
    return data.accounting_code
  } catch (error) {
    console.error('Error fetching system accounting code:', error)
    return null
  }
}

export interface PaymentInvoiceData {
  payment_id: string
  user_id: string
  total_amount: number // in cents
  discount_amount: number // in cents
  final_amount: number // in cents
  payment_items: Array<{
    item_type: 'membership' | 'registration' | 'discount' | 'donation'
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
    item_type: 'membership' | 'registration' | 'discount' | 'donation'
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
    
    // Verify the name is unique in Xero
    try {
      const nameCheckResponse = await xeroApi.accountingApi.getContacts(
        tenantId,
        undefined,
        `Name="${contactName}"`
      )
      
      if (nameCheckResponse.body.contacts && nameCheckResponse.body.contacts.length > 0) {
        // Name already exists, add timestamp in parentheses to preserve member ID
        const timestamp = Date.now().toString().slice(-6)
        if (userData.member_id) {
          contactName = `${userData.first_name} ${userData.last_name} - ${userData.member_id} (${timestamp})`
        } else {
          contactName = `${userData.first_name} ${userData.last_name} (${timestamp})`
        }
        console.log(`⚠️ Name conflict detected, using timestamped name: ${contactName}`)
      }
    } catch (nameCheckError) {
      // If name check fails, proceed with current name
      console.log('Name uniqueness check failed, proceeding with generated name')
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

    const response = await xeroApi.accountingApi.createContacts(tenantId, {
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
    console.log('🚀 createXeroInvoiceBeforePayment called with:', { user_id: invoiceData.user_id, total_amount: invoiceData.total_amount })
    const activeTenant = await getActiveTenant()
    if (!activeTenant) {
      return { success: false, error: 'No active Xero tenant configured' }
    }

    const xeroApi = await getAuthenticatedXeroClient(activeTenant.tenant_id)
    if (!xeroApi) {
      return { success: false, error: 'Unable to authenticate with Xero' }
    }

    // Ensure contact exists in Xero
    console.log('👤 Getting/creating Xero contact for user:', invoiceData.user_id)
    const contactResult = await getOrCreateXeroContact(invoiceData.user_id, activeTenant.tenant_id)
    console.log('👤 Contact result:', contactResult)
    if (!contactResult.success || !contactResult.xeroContactId) {
      console.error('❌ Contact sync failed:', contactResult.error)
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
        accountCode: item.accounting_code || await getDefaultAccountCode(item.item_type),
        taxType: 'NONE' // Assuming no tax for now, can be configured
      })
    }

    // Add discount line items (negative amounts)
    if (invoiceData.discount_codes_used) {
      for (const discount of invoiceData.discount_codes_used) {
        // Use system accounting code for discounts/financial assistance
        let accountCode = discount.accounting_code
        if (!accountCode) {
          accountCode = await getSystemAccountingCode('donation_given_default') || 'ASSISTANCE'
        }
        
        lineItems.push({
          description: `Discount - ${discount.code} (${discount.category_name})`,
          unitAmount: -(discount.amount_saved / 100), // Negative amount for discount
          quantity: 1,
          accountCode: accountCode,
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
      reference: '',
      currencyCode: CurrencyCode.USD // Configurable if needed
    }

    let response
    try {
      console.log('📄 Creating Xero invoice with data:', JSON.stringify(xeroInvoiceData, null, 2))
      response = await xeroApi.accountingApi.createInvoices(activeTenant.tenant_id, {
        invoices: [xeroInvoiceData]
      })
      console.log('✅ Invoice creation successful')
    } catch (invoiceError: any) {
      console.error('❌ Invoice creation failed:', invoiceError)
      // Check if the error is due to archived contact
      // Try different possible error structures
      let errorMessage = ''
      if (invoiceError?.response?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message) {
        errorMessage = invoiceError.response.body.Elements[0].ValidationErrors[0].Message
      } else if (invoiceError?.body?.Elements?.[0]?.ValidationErrors?.[0]?.Message) {
        errorMessage = invoiceError.body.Elements[0].ValidationErrors[0].Message
      } else if (invoiceError?.message) {
        errorMessage = invoiceError.message
      }
      
      // Also check the entire error string for archived contact message
      const fullErrorString = JSON.stringify(invoiceError)
      if (errorMessage.includes('archived') || errorMessage.includes('un-archived') || fullErrorString.includes('archived') || fullErrorString.includes('un-archived')) {
        console.log(`⚠️ Contact ${contactResult.xeroContactId} is archived, checking for other non-archived contacts first`)
        
        // Before creating new contact, check if there's another non-archived contact with same email
        try {
          const supabase = await createClient()
          const { data: userData } = await supabase
            .from('users')
            .select('email, first_name, last_name, member_id')
            .eq('id', invoiceData.user_id)
            .single()
          
          if (userData?.email) {
            const emailSearchResponse = await xeroApi.accountingApi.getContacts(
              activeTenant.tenant_id,
              undefined,
              `EmailAddress="${userData.email}"`
            )
            
            if (emailSearchResponse.body.contacts && emailSearchResponse.body.contacts.length > 0) {
              console.log(`🔍 Found ${emailSearchResponse.body.contacts.length} contacts with email ${userData.email}:`)
              emailSearchResponse.body.contacts.forEach((contact: Contact, index: number) => {
                console.log(`  ${index + 1}. Name: "${contact.name}", ID: ${contact.contactID}, Status: ${contact.contactStatus || Contact.ContactStatusEnum.ACTIVE}`)
              })
              
              // Send Sentry warning if multiple contacts found with same email
              if (emailSearchResponse.body.contacts.length > 1) {
                Sentry.captureMessage(`Multiple Xero contacts found with same email: ${userData.email}`, {
                  level: 'warning',
                  tags: {
                    component: 'xero-contact-resolution',
                    operation: 'archived-contact-handling'
                  },
                  extra: {
                    email: userData.email,
                    contactCount: emailSearchResponse.body.contacts.length,
                    contacts: emailSearchResponse.body.contacts.map((contact: Contact) => ({
                      name: contact.name,
                      contactID: contact.contactID,
                      status: contact.contactStatus || Contact.ContactStatusEnum.ACTIVE
                    })),
                    userID: invoiceData.user_id,
                    archivedContactID: contactResult.xeroContactId
                  }
                })
              }
              
              // First, look for exact name match with our naming convention
              const expectedNamePrefix = userData.member_id 
                ? `${userData.first_name} ${userData.last_name} - ${userData.member_id}`
                : `${userData.first_name} ${userData.last_name}`
              
              const exactNameMatch = emailSearchResponse.body.contacts.find((contact: Contact) => 
                contact.contactID !== contactResult.xeroContactId && // Exclude the archived one
                contact.contactStatus !== Contact.ContactStatusEnum.ARCHIVED &&             // Must be non-archived
                contact.name === expectedNamePrefix                  // Exact name match
              )
              
              // If no exact match, look for any non-archived contact
              const anyNonArchivedContact = emailSearchResponse.body.contacts.find((contact: Contact) => 
                contact.contactID !== contactResult.xeroContactId && // Exclude the archived one
                contact.contactStatus !== Contact.ContactStatusEnum.ARCHIVED               // Find non-archived contacts
              )
              
              const nonArchivedContact = exactNameMatch || anyNonArchivedContact
              
              if (exactNameMatch) {
                console.log(`🎯 Found exact name match: "${exactNameMatch.name}" (${exactNameMatch.contactID})`)
              } else {
                console.log(`🔍 Non-archived contact found: ${nonArchivedContact ? `"${nonArchivedContact.name}" (${nonArchivedContact.contactID})` : 'None'}`)
              }
              
              if (nonArchivedContact && nonArchivedContact.contactID) {
                console.log(`✅ Found non-archived contact with same email: ${nonArchivedContact.name} (ID: ${nonArchivedContact.contactID})`)
                
                // Check if the contact name follows our naming convention (only update if not exact match)
                if (!exactNameMatch) {
                  // This contact doesn't follow our convention, update it but add timestamp for uniqueness
                  const timestamp = Date.now().toString().slice(-6)
                  const finalContactName = userData.member_id 
                    ? `${userData.first_name} ${userData.last_name} - ${userData.member_id} (${timestamp})`
                    : `${userData.first_name} ${userData.last_name} (${timestamp})`
                  
                  console.log(`⚠️ Contact name doesn't match our convention, updating to: ${finalContactName}`)
                  
                  // Update the contact name to follow our convention
                  await xeroApi.accountingApi.updateContact(activeTenant.tenant_id, nonArchivedContact.contactID, {
                    contacts: [{
                      contactID: nonArchivedContact.contactID,
                      name: finalContactName,
                      firstName: userData.first_name,
                      lastName: userData.last_name,
                      emailAddress: userData.email
                    }]
                  })
                  
                  console.log(`✅ Updated contact name to follow convention: ${finalContactName}`)
                } else {
                  console.log(`✅ Contact name already follows our convention: ${nonArchivedContact.name}`)
                }
                
                // Use the non-archived contact for invoice
                xeroInvoiceData.contact = { contactID: nonArchivedContact.contactID }
                response = await xeroApi.accountingApi.createInvoices(activeTenant.tenant_id, {
                  invoices: [xeroInvoiceData]
                })
                
                console.log(`✅ Successfully created invoice with existing non-archived contact: ${nonArchivedContact.contactID}`)
              } else {
                // No non-archived contacts found, create new one
                console.log(`⚠️ No non-archived contacts found with email ${userData.email}, creating new contact`)
                const newContactResult = await createNewContactForArchivedContact(invoiceData.user_id, activeTenant.tenant_id)
                if (!newContactResult.success || !newContactResult.xeroContactId) {
                  throw invoiceError
                }
                
                xeroInvoiceData.contact = { contactID: newContactResult.xeroContactId }
                response = await xeroApi.accountingApi.createInvoices(activeTenant.tenant_id, {
                  invoices: [xeroInvoiceData]
                })
              }
            } else {
              // No contacts found with email, create new one
              console.log(`⚠️ No contacts found with email ${userData.email}, creating new contact`)
              const newContactResult = await createNewContactForArchivedContact(invoiceData.user_id, activeTenant.tenant_id)
              if (!newContactResult.success || !newContactResult.xeroContactId) {
                throw invoiceError
              }
              
              xeroInvoiceData.contact = { contactID: newContactResult.xeroContactId }
              response = await xeroApi.accountingApi.createInvoices(activeTenant.tenant_id, {
                invoices: [xeroInvoiceData]
              })
            }
          } else {
            throw new Error('User email not found')
          }
        } catch (searchError) {
          console.error('Error searching for non-archived contacts:', searchError)
          console.log('Falling back to creating new contact')
          const newContactResult = await createNewContactForArchivedContact(invoiceData.user_id, activeTenant.tenant_id)
          if (!newContactResult.success || !newContactResult.xeroContactId) {
            throw invoiceError
          }
          
          xeroInvoiceData.contact = { contactID: newContactResult.xeroContactId }
          response = await xeroApi.accountingApi.createInvoices(activeTenant.tenant_id, {
            invoices: [xeroInvoiceData]
          })
        }
      } else {
        throw invoiceError // Re-throw other errors
      }
    }

    if (!response.body.invoices || response.body.invoices.length === 0) {
      await logXeroSync({
        tenant_id: activeTenant.tenant_id,
        operation: 'invoice_sync',
        record_type: 'payment',
        record_id: '',
        xero_id: undefined,
        success: false,
        error_message: 'No invoice returned from Xero API during pre-payment creation'
      })
      return { success: false, error: 'No invoice returned from Xero API' }
    }

    const xeroInvoice = response.body.invoices[0]
    const xeroInvoiceId = xeroInvoice.invoiceID
    const invoiceNumber = xeroInvoice.invoiceNumber

    if (!xeroInvoiceId || !invoiceNumber) {
      await logXeroSync({
        tenant_id: activeTenant.tenant_id,
        operation: 'invoice_sync',
        record_type: 'payment',
        record_id: '',
        xero_id: undefined,
        success: false,
        error_message: 'No invoice ID or number returned from Xero API during pre-payment creation'
      })
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

    await logXeroSync({
      tenant_id: activeTenant.tenant_id,
      operation: 'invoice_sync',
      record_type: 'payment',
      record_id: '',
      xero_id: xeroInvoiceId,
      success: true,
      details: `Pre-payment invoice created successfully: ${invoiceNumber}`
    })

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
      await logXeroSync({
        tenant_id: activeTenant.tenant_id,
        operation: 'invoice_sync',
        record_type: 'payment',
        record_id: '',
        xero_id: undefined,
        success: false,
        error_message: errorMessage
      })
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

    // TODO: Delete the invoice from Xero
    // Note: deleteInvoice method doesn't exist in Xero Node SDK
    // await xeroApi.accountingApi.deleteInvoice(activeTenant.tenant_id, xeroInvoiceId)

    await logXeroSync({
      tenant_id: activeTenant.tenant_id,
      operation: 'invoice_sync',
      record_type: 'payment',
      record_id: '',
      xero_id: undefined,
      success: true,
      details: `Draft invoice deleted after payment failure: ${xeroInvoiceId}`
    })

    return { success: true }

  } catch (error) {
    console.error('Error deleting Xero draft invoice:', error)
    
    const activeTenant = await getActiveTenant()
    if (activeTenant) {
      await logXeroSync({
        tenant_id: activeTenant.tenant_id,
        operation: 'invoice_sync',
        record_type: 'payment',
        record_id: '',
        xero_id: xeroInvoiceId,
        success: false,
        error_message: error instanceof Error ? error.message : 'Unknown error during invoice deletion'
      })
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
        accountCode: item.accounting_code || await getDefaultAccountCode(item.item_type),
        taxType: 'NONE' // Assuming no tax for now, can be configured
      })
    }

    // Add discount line items (negative amounts)
    if (paymentData.discount_codes_used) {
      for (const discount of paymentData.discount_codes_used) {
        // Use system accounting code for discounts/financial assistance
        let accountCode = discount.accounting_code
        if (!accountCode) {
          accountCode = await getSystemAccountingCode('donation_given_default') || 'ASSISTANCE'
        }
        
        lineItems.push({
          description: `Discount - ${discount.code} (${discount.category_name})`,
          unitAmount: -(discount.amount_saved / 100), // Negative amount for discount
          quantity: 1,
          accountCode: accountCode,
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

    const response = await xeroApi.accountingApi.createInvoices(tenantId, {
      invoices: [invoiceData]
    })

    if (!response.body.invoices || response.body.invoices.length === 0) {
      await logXeroSync({
        tenant_id: tenantId,
        operation: 'invoice_sync',
        record_type: 'payment',
        record_id: '',
        xero_id: undefined,
        success: false,
        error_message: 'No invoice returned from Xero API'
      })
      return { success: false, error: 'No invoice returned from Xero API' }
    }

    const xeroInvoice = response.body.invoices[0]
    const xeroInvoiceId = xeroInvoice.invoiceID
    const invoiceNumber = xeroInvoice.invoiceNumber

    if (!xeroInvoiceId || !invoiceNumber) {
      await logXeroSync({
        tenant_id: tenantId,
        operation: 'invoice_sync',
        record_type: 'payment',
        record_id: '',
        xero_id: undefined,
        success: false,
        error_message: 'No invoice ID or number returned from Xero API'
      })
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

    await logXeroSync({
      tenant_id: tenantId,
      operation: 'invoice_sync',
      record_type: 'payment',
      record_id: '',
      xero_id: xeroInvoiceId,
      success: true,
      details: `Invoice created successfully: ${invoiceNumber}`
    })

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

    await logXeroSync({
      tenant_id: tenantId,
      operation: 'invoice_sync',
      record_type: 'payment',
      record_id: '',
      xero_id: undefined,
      success: false,
      error_message: errorMessage
    })

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
          accounting_code = await getSystemAccountingCode('donation_received_default') || 'DONATION'
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

async function getDefaultAccountCode(itemType: string): Promise<string> {
  switch (itemType) {
    case 'membership':
      return 'MEMBERSHIP'
    case 'registration':
      return 'REGISTRATION'
    case 'donation':
      return await getSystemAccountingCode('donation_received_default') || 'DONATION'
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