/**
 * Xero Staging System
 * 
 * Implements staging-first approach for Xero integration:
 * 1. Always create staging records first (guaranteed success)
 * 2. Batch sync staged records to Xero API
 * 3. Admin recovery for failed syncs
 */

import { createAdminClient } from './supabase/server'
import { getActiveXeroTenants } from './xero-client'
import { PaymentInvoiceData, PrePaymentInvoiceData } from './xero-invoices'
import { Database } from '@/types/database'
import { logger } from './logging/logger'

type StagingPaymentData = {
  payment_id?: string
  user_id: string
  total_amount: number
  discount_amount: number
  final_amount: number
  payment_items: Array<{
    item_type: 'membership' | 'registration' | 'donation'
    item_id: string | null
    amount: number
    description?: string
    accounting_code?: string
  }>
  discount_codes_used?: Array<{
    code: string
    amount_saved: number
    category_name: string
    accounting_code?: string
  }>
  stripe_payment_intent_id?: string
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

      // Get active tenants
      const tenants = await getActiveXeroTenants()
      if (tenants.length === 0) {
        logger.logXeroSync(
          'staging-no-tenants',
          'No active Xero tenants, skipping staging',
          { source: 'immediate' },
          'warn'
        )
        return true // Not a failure - just no Xero configured
      }

      // Create staging records for each tenant
      let allSucceeded = true
      for (const tenant of tenants) {
        const success = await this.createInvoiceStaging(data, tenant.tenant_id, options)
        if (!success) allSucceeded = false
      }

      return allSucceeded
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
      trigger_source: 'user_memberships' | 'user_registrations'
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
      
      // Get active tenants
      const tenants = await getActiveXeroTenants()
      if (tenants.length === 0) {
        logger.logXeroSync(
          'staging-no-tenants',
          'No active Xero tenants, skipping staging',
          { source: 'free-purchase' },
          'warn'
        )
        return true // Not a failure - just no Xero configured
      }

      // Create staging records for each tenant
      let allSucceeded = true
      for (const tenant of tenants) {
        const success = await this.createInvoiceStaging(stagingData, tenant.tenant_id)
        if (!success) allSucceeded = false
      }

      return allSucceeded
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
   * Create staging records for invoice and payment
   */
  private async createInvoiceStaging(
    data: StagingPaymentData, 
    tenantId: string,
    options?: { isFree?: boolean }
  ): Promise<boolean> {
    try {
      // Generate unique invoice number for staging
      const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
      // Create invoice staging record
      const { data: invoiceStaging, error: invoiceError } = await this.supabase
        .from('xero_invoices')
        .insert({
          payment_id: data.payment_id || null,
          tenant_id: tenantId,
          xero_invoice_id: '00000000-0000-0000-0000-000000000000', // Placeholder until synced
          invoice_number: invoiceNumber,
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
            invoiceNumber,
            error: invoiceError?.message || 'No staging record returned'
          },
          'error'
        )
        return false
      }

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
              invoiceNumber,
              itemType: lineItem.item_type,
              error: lineError.message
            },
            'error'
          )
          // Continue with other line items
        }
      }

      // Create payment staging record if this is a paid purchase
      if (data.payment_id && data.final_amount > 0) {
        const { error: paymentError } = await this.supabase
          .from('xero_payments')
          .insert({
            xero_invoice_id: invoiceStaging.id,
            tenant_id: tenantId,
            xero_payment_id: '00000000-0000-0000-0000-000000000000', // Placeholder until synced
            payment_method: 'stripe',
            bank_account_code: 'STRIPE', // Default - should be configurable
            amount_paid: data.final_amount,
            stripe_fee_amount: 0, // Calculate if needed
            reference: data.stripe_payment_intent_id || '',
            sync_status: 'staged',
            staged_at: new Date().toISOString(),
            staging_metadata: {
              payment_id: data.payment_id,
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
              invoiceNumber,
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
          invoiceNumber,
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
    trigger_source: 'user_memberships' | 'user_registrations'
  }) {
    // This will get the membership or registration data for free purchases
    // TODO: Implement based on trigger_source
    logger.logXeroSync(
      'staging-free-data-placeholder',
      'Get free purchase data - to be implemented',
      { recordId: event.record_id, source: event.trigger_source },
      'warn'
    )
    return null
  }

  /**
   * Convert purchase data to staging format
   */
  private async convertToStagingData(
    purchaseData: any, 
    type: 'user_memberships' | 'user_registrations'
  ): Promise<StagingPaymentData> {
    // TODO: Convert membership/registration data to staging format
    logger.logXeroSync(
      'staging-convert-data-placeholder',
      'Convert to staging data - to be implemented',
      { type },
      'warn'
    )
    return {
      user_id: purchaseData.user_id,
      total_amount: 0,
      discount_amount: 0,
      final_amount: 0,
      payment_items: []
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
   * Get all pending staging records for batch sync
   */
  async getPendingStagingRecords() {
    try {
      const { data: pendingInvoices } = await this.supabase
        .from('xero_invoices')
        .select(`
          *,
          xero_invoice_line_items (*)
        `)
        .in('sync_status', ['pending', 'staged'])
        .order('staged_at', { ascending: true })

      const { data: pendingPayments } = await this.supabase
        .from('xero_payments')
        .select('*')
        .in('sync_status', ['pending', 'staged'])
        .order('staged_at', { ascending: true })

      return {
        invoices: pendingInvoices || [],
        payments: pendingPayments || []
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