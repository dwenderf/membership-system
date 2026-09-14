import { createXeroInvoiceForPayment } from './invoices'
import { recordStripePaymentInXero } from './payments'
import { getActiveXeroTenants, validateXeroConnection } from './client'
import { createAdminClient } from '../supabase/server'
import { logger } from '@/lib/logging/logger'

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
      logger.logXeroSync('auto-sync-payment-not-found', 'Payment not found for auto-sync', { paymentId }, 'warn')
      return
    }

    if (payment.status !== 'completed') {
      logger.logXeroSync('auto-sync-skip-not-completed', 'Payment not completed, skipping Xero sync', { paymentId }, 'debug')
      return
    }

    // Get all active Xero tenants
    const activeTenants = await getActiveXeroTenants()

    if (activeTenants.length === 0) {
      logger.logXeroSync('auto-sync-skip-no-tenants', 'No active Xero tenants configured, skipping sync', { paymentId }, 'debug')
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
      logger.logXeroSync('auto-sync-skip-no-connection', 'No valid Xero connections found, skipping sync', { paymentId }, 'warn')
      return
    }

    logger.logXeroSync('auto-sync-started', `Auto-syncing payment ${paymentId} to Xero tenant: ${primaryTenant.tenant_name}`, { paymentId, tenantId: primaryTenant.tenant_id }, 'debug')

    const result = await createXeroInvoiceForPayment(paymentId, primaryTenant.tenant_id)

    if (result.success) {
      logger.logXeroSync('auto-sync-invoice-created', `Payment ${paymentId} successfully synced to Xero as invoice ${result.invoiceNumber}`, { paymentId, invoiceNumber: result.invoiceNumber }, 'info')

      // Also record the payment in Xero for complete reconciliation
      try {
        const paymentResult = await recordStripePaymentInXero(paymentId, primaryTenant.tenant_id)
        if (paymentResult.success) {
          logger.logXeroSync('auto-sync-payment-recorded', `Payment ${paymentId} also recorded in Xero with ID ${paymentResult.xeroPaymentId}`, { paymentId, xeroPaymentId: paymentResult.xeroPaymentId }, 'info')
        } else {
          logger.logXeroSync('auto-sync-payment-record-failed', `Invoice created but payment recording failed for ${paymentId}: ${paymentResult.error}`, { paymentId, error: paymentResult.error }, 'warn')
        }
      } catch (paymentError) {
        logger.logXeroSync('auto-sync-payment-record-error', `Invoice created but payment recording failed for ${paymentId}`, { paymentId, error: paymentError instanceof Error ? paymentError.message : String(paymentError) }, 'warn')
        // Don't fail the overall sync - invoice was created successfully
      }
    } else {
      // Use warn (not error): reported to Sentry explicitly below with richer context -
      // logger.error would auto-report a second, less detailed event.
      logger.logXeroSync('auto-sync-invoice-failed', `Failed to sync payment ${paymentId} to Xero: ${result.error}`, { paymentId, tenantId: primaryTenant.tenant_id, error: result.error }, 'warn')

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
    // Use warn (not error): reported to Sentry explicitly below.
    logger.logXeroSync('auto-sync-error', 'Error in auto-sync to Xero', { paymentId, error: error instanceof Error ? error.message : String(error) }, 'warn')

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
    logger.logXeroSync('auto-sync-status-check-error', 'Error checking Xero auto-sync status', { error: error instanceof Error ? error.message : String(error) }, 'error')
    return false
  }
}

// Schedule delayed sync (useful if immediate sync fails)
export async function scheduleDelayedXeroSync(paymentId: string, delayMinutes: number = 5): Promise<void> {
  // This is a simple implementation - in production you might use a queue system
  setTimeout(async () => {
    logger.logXeroSync('auto-sync-retry', `Retrying Xero sync for payment ${paymentId} after ${delayMinutes} minutes`, { paymentId, delayMinutes }, 'debug')
    await autoSyncPaymentToXero(paymentId)
  }, delayMinutes * 60 * 1000)
}