/**
 * Shared helper for staging refund notification emails
 * Used by both webhook handler and refund processing endpoints
 */

import { createAdminClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/date-utils'
import { emailStagingManager } from '@/lib/email/staging'
import { stageAdminRefundNotification } from '@/lib/email/admin-notifications'
import { stageCaptainRosterChangeNotification } from '@/lib/email/captain-notifications'

/**
 * Stage a refund notification email for batch processing
 *
 * Fetches all necessary data (user, refund, payment, invoice) and stages
 * the refund notification email. Used by both Stripe webhook handler and
 * zero-dollar refund processing.
 *
 * @param refundId - The refund ID
 * @param userId - The user ID who received the refund
 * @param paymentId - The original payment ID
 */
export async function stageRefundNotificationEmail(
  refundId: string,
  userId: string,
  paymentId: string
): Promise<void> {
  try {
    const supabase = createAdminClient()

    // Get user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('first_name, last_name, email')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      console.error(`Failed to fetch user details for refund email:`, userError)
      return
    }

    // Get refund details
    const { data: refund, error: refundError } = await supabase
      .from('refunds')
      .select('amount, reason, created_at')
      .eq('id', refundId)
      .single()

    if (refundError || !refund) {
      console.error(`Failed to fetch refund details for email:`, refundError)
      return
    }

    // Get payment details
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('final_amount, completed_at, created_at')
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      console.error(`Failed to fetch payment details for refund email:`, paymentError)
      return
    }

    // Get original invoice number for better user experience
    const { data: invoice } = await supabase
      .from('xero_invoices')
      .select('invoice_number')
      .eq('payment_id', paymentId)
      .eq('invoice_type', 'ACCREC')
      .single()

    const invoiceNumber = invoice?.invoice_number || 'N/A'

    if (!process.env.LOOPS_REFUND_TEMPLATE_ID) {
      console.warn('LOOPS_REFUND_TEMPLATE_ID not configured, skipping refund email')
      return
    }

    // Stage the refund notification email for batch processing
    await emailStagingManager.stageEmail({
      user_id: userId,
      email_address: user.email,
      event_type: 'refund.processed',
      subject: `Refund Processed - $${(refund.amount / 100).toFixed(2)}`,
      template_id: process.env.LOOPS_REFUND_TEMPLATE_ID,
      email_data: {
        userName: `${user.first_name} ${user.last_name}`,
        refundAmount: (refund.amount / 100).toFixed(2),
        originalAmount: (payment.final_amount / 100).toFixed(2),
        reason: refund.reason || 'Refund processed by administrator',
        paymentDate: formatDate(new Date(payment.completed_at || payment.created_at)),
        invoiceNumber: invoiceNumber,
        refundDate: formatDate(new Date(refund.created_at)),
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/user/dashboard`
      },
      triggered_by: 'automated',
      related_entity_type: 'payments',
      related_entity_id: refundId,
      payment_id: paymentId
    })

    console.log(`Staged refund notification email for ${user.email} for refund ${refundId}`)

    // Notify opted-in admins of the refund (fire-and-forget)
    stageAdminRefundNotification(
      userId,
      paymentId,
      refund.amount,
      payment.final_amount
    ).catch((err) => console.warn('stageRefundNotificationEmail: admin notification failed (non-fatal)', err))

    // Notify captain(s) that the player has left (fire-and-forget)
    // Resolve the registrationId from the refunded user_registration record
    const { data: userReg } = await supabase
      .from('user_registrations')
      .select('registration_id, registration_category_id, registration_category:registration_categories(custom_name, category:categories(name))')
      .eq('payment_id', paymentId)
      .eq('user_id', userId)
      .single()

    if (userReg?.registration_id) {
      const category = userReg.registration_category
        ? (Array.isArray(userReg.registration_category) ? userReg.registration_category[0] : userReg.registration_category)
        : null
      const masterCategory = category?.category
        ? (Array.isArray(category.category) ? category.category[0] : category.category)
        : null
      const categoryName = category?.custom_name || masterCategory?.name || 'Standard'

      stageCaptainRosterChangeNotification(
        userReg.registration_id,
        userId,
        'left',
        categoryName,
        refund.created_at,
        refund.amount
      ).catch((err) => console.warn('stageRefundNotificationEmail: captain notification failed (non-fatal)', err))
    }

  } catch (error) {
    console.error('Error staging refund notification email:', error)
    // Don't throw - we don't want to fail the operation for email errors
  }
}
