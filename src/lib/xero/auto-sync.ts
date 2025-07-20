import { createXeroInvoiceForPayment } from './invoices'
import { recordStripePaymentInXero } from './payments'
import { getActiveXeroTenants, validateXeroConnection } from './client'
import { createAdminClient } from '../supabase/server'

// Automatically sync a payment to all active Xero tenants
export async function autoSyncPaymentToXero(paymentId: string): Promise<void> {
  try {
    const supabase = createAdminClient()

    // Check if payment is completed
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('id, status, final_amount')
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      console.error('Payment not found for auto-sync:', paymentId)
      return
    }

    if (payment.status !== 'completed') {
      console.log('Payment not completed, skipping Xero sync:', paymentId)
      return
    }

    // Get all active Xero tenants
    const activeTenants = await getActiveXeroTenants()
    
    if (activeTenants.length === 0) {
      console.log('No active Xero tenants configured, skipping sync for payment:', paymentId)
      return
    }

    // Validate connection to at least one tenant before attempting sync
    let hasValidConnection = false
    let primaryTenant = null
    
    for (const tenant of activeTenants) {
      const isValid = await validateXeroConnection(tenant.tenant_id)
      if (isValid) {
        hasValidConnection = true
        primaryTenant = tenant
        break
      }
    }

    if (!hasValidConnection || !primaryTenant) {
      console.log('No valid Xero connections found, skipping sync for payment:', paymentId)
      return
    }
    
    console.log(`Auto-syncing payment ${paymentId} to Xero tenant: ${primaryTenant.tenant_name}`)

    const result = await createXeroInvoiceForPayment(paymentId, primaryTenant.tenant_id)
    
    if (result.success) {
      console.log(`✅ Payment ${paymentId} successfully synced to Xero as invoice ${result.invoiceNumber}`)
      
      // Also record the payment in Xero for complete reconciliation
      try {
        const paymentResult = await recordStripePaymentInXero(paymentId, primaryTenant.tenant_id)
        if (paymentResult.success) {
          console.log(`✅ Payment ${paymentId} also recorded in Xero with ID ${paymentResult.xeroPaymentId}`)
        } else {
          console.warn(`⚠️ Invoice created but payment recording failed for ${paymentId}: ${paymentResult.error}`)
        }
      } catch (paymentError) {
        console.warn(`⚠️ Invoice created but payment recording failed for ${paymentId}:`, paymentError)
        // Don't fail the overall sync - invoice was created successfully
      }
    } else {
      console.error(`❌ Failed to sync payment ${paymentId} to Xero:`, result.error)
      
      // Log error but don't fail the webhook - payment was processed successfully
      const { captureException } = await import('@sentry/nextjs')
      captureException(new Error(`Xero auto-sync failed for payment ${paymentId}: ${result.error}`), {
        extra: {
          paymentId,
          tenantId: primaryTenant.tenant_id,
          tenantName: primaryTenant.tenant_name,
          error: result.error
        }
      })
    }

  } catch (error) {
    console.error('Error in auto-sync to Xero:', error)
    
    // Log error but don't fail the webhook
    const { captureException } = await import('@sentry/nextjs')
    captureException(error, {
      extra: {
        paymentId,
        operation: 'xero_auto_sync'
      }
    })
  }
}

// Utility to check if Xero auto-sync is enabled
export async function isXeroAutoSyncEnabled(): Promise<boolean> {
  try {
    const activeTenants = await getActiveXeroTenants()
    return activeTenants.length > 0
  } catch (error) {
    console.error('Error checking Xero auto-sync status:', error)
    return false
  }
}

// Schedule delayed sync (useful if immediate sync fails)
export async function scheduleDelayedXeroSync(paymentId: string, delayMinutes: number = 5): Promise<void> {
  // This is a simple implementation - in production you might use a queue system
  setTimeout(async () => {
    console.log(`Retrying Xero sync for payment ${paymentId} after ${delayMinutes} minutes`)
    await autoSyncPaymentToXero(paymentId)
  }, delayMinutes * 60 * 1000)
}