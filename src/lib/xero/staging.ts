/**
 * Xero Staging System
 * 
 * Implements staging-first approach for Xero integration:
 * 1. Always create staging records first (guaranteed success)
 * 2. Batch sync staged records to Xero API
 * 3. Admin recovery for failed syncs
 */

import { createAdminClient } from '../supabase/server'
import { logger } from '../logging/logger'
import { Cents, centsToCents } from '../../types/currency'

export type StagingPaymentData = {
  payment_id?: string
  user_id: string
  total_amount: Cents
  discount_amount: Cents
  final_amount: Cents
  payment_items: Array<{
    item_type: 'membership' | 'registration' | 'discount' | 'donation'
    item_id: string | null
    amount: Cents
    description?: string
    accounting_code?: string
  }>
  discount_codes_used?: Array<{
    code: string
    amount_saved: Cents
    category_name: string
    accounting_code?: string
  }>
  stripe_payment_intent_id?: string | null
}

export class XeroStagingManager {
  private supabase: ReturnType<typeof createAdminClient>

  constructor() {
    this.supabase = createAdminClient()
  }

  /**
   * Create staging records for a paid purchase
   */
  async createPaidPurchaseStaging(paymentId: string): Promise<boolean> {
    try {
      logger.logXeroSync(
        'staging-paid-purchase-start',
        'Creating Xero staging for paid purchase',
        { paymentId },
        'info'
      )

      // Check if staging data already exists for this payment
      const { data: existingStaging } = await this.supabase
        .from('xero_invoices')
        .select('id')
        .eq('payment_id', paymentId)
        .eq('sync_status', 'staged')
        .limit(1)

      if (existingStaging && existingStaging.length > 0) {
        logger.logXeroSync(
          'staging-paid-purchase-exists',
          'Staging data already exists for this payment',
          { paymentId },
          'info'
        )
        return true
      }

      logger.logXeroSync(
        'staging-paid-purchase-no-existing',
        'No existing staging data found, but payment_items table has been removed. Staging should have been created during payment intent creation.',
        { paymentId },
        'warn'
      )

      // In the new architecture, staging data should already exist from payment intent creation
      // If it doesn't exist, this indicates a problem with the payment flow
      return false
    } catch (error) {
      logger.logXeroSync(
        'staging-paid-purchase-error',
        'Error creating paid purchase staging',
        { 
          paymentId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return false
    }
  }

  /**
   * Create staging records immediately with provided invoice data
   * (for immediate staging at purchase time)
   */
  async createImmediateStaging(data: StagingPaymentData, options?: { isFree?: boolean }): Promise<boolean> {
    try {
      logger.logXeroSync(
        'staging-immediate-start',
        'Creating immediate Xero staging for user',
        { userId: data.user_id },
        'info'
      )

      // Create staging record without tenant_id - will be populated during sync
      const success = await this.createInvoiceStaging(data, null, options)
      
      return success
    } catch (error) {
      logger.logXeroSync(
        'staging-immediate-error',
        'Error creating immediate staging',
        { 
          userId: data.user_id,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return false
    }
  }

  /**
   * Create staging records for a free purchase
   */
  async createFreePurchaseStaging(
    event: {
      user_id: string
      record_id: string
      trigger_source: 'user_memberships' | 'user_registrations' | 'free_registration' | 'free_membership'
    }
  ): Promise<boolean> {
    try {
      logger.logXeroSync(
        'staging-free-purchase-start',
        'Creating Xero staging for free purchase',
        { recordId: event.record_id, source: event.trigger_source },
        'info'
      )

      // Get the purchase data based on type
      const purchaseData = await this.getFreePurchaseData(event)
      if (!purchaseData) {
        logger.logXeroSync(
          'staging-free-purchase-no-data',
          'No purchase data found for free staging',
          { recordId: event.record_id, source: event.trigger_source },
          'error'
        )
        return false
      }

      // Convert to staging format
      const stagingData = await this.convertToStagingData(purchaseData, event.trigger_source)
      
      // Create staging record without tenant_id - will be populated during sync
      const success = await this.createInvoiceStaging(stagingData, null)
      
      return success
    } catch (error) {
      logger.logXeroSync(
        'staging-free-purchase-error',
        'Error creating free purchase staging',
        { 
          recordId: event.record_id,
          source: event.trigger_source,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return false
    }
  }

  /**
   * Get the Stripe bank account code from system accounting codes
   */
  private async getStripeBankAccountCode(): Promise<string> {
    try {
      const { data: systemCode, error } = await this.supabase
        .from('system_accounting_codes')
        .select('accounting_code')
        .eq('code_type', 'stripe_bank_account')
        .single()
      
      if (error || !systemCode) {
        logger.logXeroSync(
          'staging-bank-account-not-found',
          'Stripe bank account code not found in system_accounting_codes, using default',
          { error: error?.message },
          'warn'
        )
        return '090' // Default fallback
      }
      
      return systemCode.accounting_code
    } catch (error) {
      logger.logXeroSync(
        'staging-bank-account-error',
        'Error getting Stripe bank account code, using default',
        { error: error instanceof Error ? error.message : String(error) },
        'warn'
      )
      return '090' // Default fallback
    }
  }

  /**
   * Create staging records for invoice and payment
   */
  private async createInvoiceStaging(
    data: StagingPaymentData, 
    tenantId: string | null,
    options?: { isFree?: boolean }
  ): Promise<boolean> {
    try {
      // Let Xero generate its own invoice number - don't set one here
      
      // Create invoice staging record
      const { data: invoiceStaging, error: invoiceError } = await this.supabase
        .from('xero_invoices')
        .insert({
          payment_id: data.payment_id || null,
          tenant_id: tenantId, // Can be null during staging
          xero_invoice_id: null, // Will be populated when synced to Xero
          invoice_number: null, // Let Xero generate the invoice number
          invoice_type: 'ACCREC',
          invoice_status: options?.isFree ? 'AUTHORISED' : 'DRAFT',
          total_amount: data.total_amount,
          discount_amount: data.discount_amount,
          net_amount: data.final_amount,
          stripe_fee_amount: 0, // Calculate from payment data if needed
          sync_status: 'staged',
          staged_at: new Date().toISOString(),
          staging_metadata: {
            user_id: data.user_id,
            payment_items: data.payment_items,
            discount_codes_used: data.discount_codes_used || [],
            stripe_payment_intent_id: data.stripe_payment_intent_id,
            created_at: new Date().toISOString()
          }
        })
        .select()
        .single()

      if (invoiceError || !invoiceStaging) {
        logger.logXeroSync(
          'staging-invoice-create-error',
          'Failed to create invoice staging',
          { 
            tenantId,
            error: invoiceError?.message || 'No staging record returned'
          },
          'error'
        )
        return false
      }

      // Link the business record to the Xero invoice
      await this.linkBusinessRecordToInvoice(data, invoiceStaging.id)

      // Create line item staging records
      const lineItems = this.generateLineItems(data)
      for (const lineItem of lineItems) {
        const { error: lineError } = await this.supabase
          .from('xero_invoice_line_items')
          .insert({
            xero_invoice_id: invoiceStaging.id,
            line_item_type: lineItem.item_type,
            item_id: lineItem.item_id,
            description: lineItem.description,
            quantity: lineItem.quantity,
            unit_amount: lineItem.unit_amount,
            account_code: lineItem.account_code,
            tax_type: 'NONE',
            line_amount: lineItem.line_amount
          })

        if (lineError) {
          logger.logXeroSync(
            'staging-line-item-error',
            'Failed to create line item staging',
            { 
              tenantId,
              itemType: lineItem.item_type,
              error: lineError.message
            },
            'error'
          )
          // Continue with other line items
        }
      }

      // Create payment staging record if this is a paid purchase
      if (data.final_amount > 0) {
        const stripeBankAccountCode = await this.getStripeBankAccountCode()
        const { error: paymentError } = await this.supabase
          .from('xero_payments')
          .insert({
            xero_invoice_id: invoiceStaging.id,
            tenant_id: tenantId, // Can be null during staging
            xero_payment_id: null, // Will be populated when synced to Xero
            payment_method: 'stripe',
            bank_account_code: stripeBankAccountCode,
            amount_paid: data.final_amount,
            stripe_fee_amount: 0, // Will be calculated when payment is completed
            reference: '', // Will be set to invoice number during sync
            sync_status: 'staged',
            staged_at: new Date().toISOString(),
            staging_metadata: {
              payment_id: data.payment_id || null,
              stripe_payment_intent_id: data.stripe_payment_intent_id,
              created_at: new Date().toISOString()
            }
          })

        if (paymentError) {
          logger.logXeroSync(
            'staging-payment-create-error',
            'Failed to create payment staging',
            { 
              tenantId,
              amount: data.final_amount,
              error: paymentError.message
            },
            'error'
          )
          return false
        }
      }

      logger.logXeroSync(
        'staging-records-created',
        'Staging records created for tenant',
        { 
          tenantId,
          isFree: options?.isFree || false
        },
        'info'
      )
      return true
      
    } catch (error) {
      logger.logXeroSync(
        'staging-records-error',
        'Error creating staging records',
        { 
          tenantId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return false
    }
  }

  // getPaymentDataForStaging method removed - staging data is now created during payment intent creation
  // and stored in xero_invoices.staging_metadata with all necessary payment item details

  /**
   * Get free purchase data
   */
  private async getFreePurchaseData(event: {
    user_id: string
    record_id: string
    trigger_source: 'user_memberships' | 'user_registrations' | 'free_registration' | 'free_membership'
  }) {
    try {
      if (event.trigger_source === 'user_registrations' || event.trigger_source === 'free_registration') {
        // Get registration data
        const { data: registration, error } = await this.supabase
          .from('user_registrations')
          .select(`
            *,
            registration:registrations (
              name,
              season:seasons (name, start_date, end_date)
            ),
            registration_category:registration_categories (
              name,
              price,
              accounting_code
            ),
            payment:payments (
              id,
              final_amount,
              discount_amount,
              stripe_payment_intent_id
            )
          `)
          .eq('id', event.record_id)
          .single()

        if (error || !registration) {
          logger.logXeroSync(
            'staging-free-registration-not-found',
            'Registration not found for free staging',
            { recordId: event.record_id, error },
            'error'
          )
          return null
        }

        return {
          type: 'registration',
          data: registration,
          user_id: event.user_id
        }
      } else if (event.trigger_source === 'user_memberships' || event.trigger_source === 'free_membership') {
        // Get membership data
        const { data: membership, error } = await this.supabase
          .from('user_memberships')
          .select(`
            *,
            membership:memberships (
              name,
              price,
              accounting_code,
              season:seasons (name, start_date, end_date)
            ),
            payment:payments (
              id,
              final_amount,
              discount_amount,
              stripe_payment_intent_id
            )
          `)
          .eq('id', event.record_id)
          .single()

        if (error || !membership) {
          logger.logXeroSync(
            'staging-free-membership-not-found',
            'Membership not found for free staging',
            { recordId: event.record_id, error },
            'error'
          )
          return null
        }

        return {
          type: 'membership',
          data: membership,
          user_id: event.user_id
        }
      }

      logger.logXeroSync(
        'staging-free-unknown-source',
        'Unknown trigger source for free purchase',
        { recordId: event.record_id, source: event.trigger_source },
        'error'
      )
      return null
    } catch (error) {
      logger.logXeroSync(
        'staging-free-data-error',
        'Error getting free purchase data',
        { 
          recordId: event.record_id,
          source: event.trigger_source,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return null
    }
  }

  /**
   * Convert purchase data to staging format
   */
  private async convertToStagingData(
    purchaseData: any, 
    type: 'user_memberships' | 'user_registrations' | 'free_registration' | 'free_membership'
  ): Promise<StagingPaymentData> {
    try {
      if (type === 'user_registrations' || type === 'free_registration') {
        const registration = purchaseData.data
        const payment = registration.payment
        
        return {
          payment_id: payment?.id || null,
          user_id: purchaseData.user_id,
          total_amount: centsToCents(registration.registration_category?.price || 0),
          discount_amount: centsToCents(payment?.discount_amount || 0),
          final_amount: centsToCents(payment?.final_amount || 0),
          payment_items: [{
            item_type: 'registration',
            item_id: registration.registration_id,
            amount: centsToCents(registration.amount_paid || 0),
            description: `${registration.registration.name} - ${registration.registration_category?.name || 'Standard'}`,
            accounting_code: registration.registration_category?.accounting_code || 'REGISTRATION'
          }],
          stripe_payment_intent_id: payment?.stripe_payment_intent_id || null
        }
      } else if (type === 'user_memberships' || type === 'free_membership') {
        const membership = purchaseData.data
        const payment = membership.payment
        
        return {
          payment_id: payment?.id || null,
          user_id: purchaseData.user_id,
          total_amount: centsToCents(membership.membership?.price || 0),
          discount_amount: centsToCents(payment?.discount_amount || 0),
          final_amount: centsToCents(payment?.final_amount || 0),
          payment_items: [{
            item_type: 'membership',
            item_id: membership.membership_id,
            amount: centsToCents(membership.amount_paid || 0),
            description: `${membership.membership.name} (${membership.months_purchased || 1} month${membership.months_purchased !== 1 ? 's' : ''})`,
            accounting_code: membership.membership?.accounting_code || 'MEMBERSHIP'
          }],
          stripe_payment_intent_id: payment?.stripe_payment_intent_id || null
        }
      }

      logger.logXeroSync(
        'staging-convert-unknown-type',
        'Unknown type for staging data conversion',
        { type },
        'error'
      )
      
      return {
        user_id: purchaseData.user_id,
        total_amount: centsToCents(0),
        discount_amount: centsToCents(0),
        final_amount: centsToCents(0),
        payment_items: []
      }
    } catch (error) {
      logger.logXeroSync(
        'staging-convert-data-error',
        'Error converting purchase data to staging format',
        { 
          type,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      
      return {
        user_id: purchaseData.user_id,
        total_amount: centsToCents(0),
        discount_amount: centsToCents(0),
        final_amount: centsToCents(0),
        payment_items: []
      }
    }
  }

  /**
   * Get item details for description and accounting codes
   */
  private async getItemDetails(itemType: string, itemId: string | null) {
    if (!itemId) return null

    try {
      if (itemType === 'membership') {
        const { data } = await this.supabase
          .from('memberships')
          .select('name, accounting_code')
          .eq('id', itemId)
          .single()
        
        return {
          description: `Membership: ${data?.name || 'Unknown'}`,
          accounting_code: data?.accounting_code || 'MEMBERSHIP'
        }
      } else if (itemType === 'registration') {
        const { data } = await this.supabase
          .from('registrations')
          .select('name')
          .eq('id', itemId)
          .single()
        
        return {
          description: `Registration: ${data?.name || 'Unknown'}`,
          accounting_code: 'REGISTRATION'
        }
      }
      
      return null
    } catch (error) {
      logger.logXeroSync(
        'staging-item-details-error',
        'Error getting item details',
        { 
          itemType,
          itemId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return null
    }
  }

  /**
   * Generate line items for invoice
   */
  private generateLineItems(data: StagingPaymentData) {
    const lineItems = []

    // Add payment items
    for (const item of data.payment_items) {
      lineItems.push({
        item_type: item.item_type,
        item_id: item.item_id,
        description: item.description || `${item.item_type} purchase`,
        quantity: 1,
        unit_amount: item.amount,
        account_code: item.accounting_code || 'SALES',
        line_amount: item.amount
      })
    }

    // Add discount line items (negative amounts)
    if (data.discount_codes_used) {
      for (const discount of data.discount_codes_used) {
        lineItems.push({
          item_type: 'discount' as const,
          item_id: null,
          description: `Discount: ${discount.code} (${discount.category_name})`,
          quantity: 1,
          unit_amount: -discount.amount_saved,
          account_code: discount.accounting_code || 'DISCOUNT',
          line_amount: -discount.amount_saved
        })
      }
    }

    return lineItems
  }

  /**
   * Link business records (user_memberships, user_registrations) to Xero invoices
   * This ensures we can track which business records correspond to which Xero invoices
   */
  private async linkBusinessRecordToInvoice(data: StagingPaymentData, xeroInvoiceId: string): Promise<void> {
    try {
      // Find the business record based on the payment items
      const membershipItem = data.payment_items.find(item => item.item_type === 'membership')
      const registrationItem = data.payment_items.find(item => item.item_type === 'registration')

      if (membershipItem?.item_id) {
        // Link user_membership to Xero invoice
        const { error: membershipError } = await this.supabase
          .from('user_memberships')
          .update({ xero_invoice_id: xeroInvoiceId })
          .eq('id', membershipItem.item_id)

        if (membershipError) {
          logger.logXeroSync(
            'staging-link-membership-error',
            'Failed to link membership to Xero invoice',
            { 
              membershipId: membershipItem.item_id,
              xeroInvoiceId,
              error: membershipError.message
            },
            'warn'
          )
        } else {
          logger.logXeroSync(
            'staging-link-membership-success',
            'Successfully linked membership to Xero invoice',
            { 
              membershipId: membershipItem.item_id,
              xeroInvoiceId
            },
            'info'
          )
        }
      }

      if (registrationItem?.item_id) {
        // Link user_registration to Xero invoice
        const { error: registrationError } = await this.supabase
          .from('user_registrations')
          .update({ xero_invoice_id: xeroInvoiceId })
          .eq('id', registrationItem.item_id)

        if (registrationError) {
          logger.logXeroSync(
            'staging-link-registration-error',
            'Failed to link registration to Xero invoice',
            { 
              registrationId: registrationItem.item_id,
              xeroInvoiceId,
              error: registrationError.message
            },
            'warn'
          )
        } else {
          logger.logXeroSync(
            'staging-link-registration-success',
            'Successfully linked registration to Xero invoice',
            { 
              registrationId: registrationItem.item_id,
              xeroInvoiceId
            },
            'info'
          )
        }
      }
    } catch (error) {
      logger.logXeroSync(
        'staging-link-business-record-error',
        'Error linking business record to Xero invoice',
        { 
          xeroInvoiceId,
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
    }
  }

  /**
   * Get all pending staging records for batch sync using centralized function
   */
  async getPendingStagingRecords() {
    try {
      const { xeroBatchSyncManager } = await import('@/lib/xero/batch-sync-xero')
      const { invoices, payments } = await xeroBatchSyncManager.getPendingXeroRecords()
      
      return {
        invoices,
        payments // Use filtered payments for consistency
      }
    } catch (error) {
      logger.logXeroSync(
        'staging-pending-records-error',
        'Error getting pending staging records',
        { 
          error: error instanceof Error ? error.message : String(error)
        },
        'error'
      )
      return { invoices: [], payments: [] }
    }
  }
}

// Export singleton instance
export const xeroStagingManager = new XeroStagingManager()