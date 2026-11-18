/**
 * Issue #521: payments on manually created Xero invoices reach the webhook with
 * only `invoice`/`EmailAddress` metadata. They must log at info level, not error,
 * while intents with neither app metadata nor `invoice` still log an error.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock'

jest.mock('@/lib/supabase/server', () => ({
  createAdminClient: jest.fn()
}))

jest.mock('@/lib/stripe/server-client', () => ({
  getStripe: jest.fn()
}))

jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logSystem: jest.fn(),
    logPaymentProcessing: jest.fn()
  }
}))

jest.mock('@/lib/membership-utils', () => ({
  calculateMembershipStartDate: jest.fn(),
  calculateMembershipEndDate: jest.fn()
}))

jest.mock('@/lib/xero/invoices', () => ({
  deleteXeroDraftInvoice: jest.fn()
}))

jest.mock('@/lib/payment-completion-processor', () => ({
  paymentProcessor: {
    processPaymentCompletion: jest.fn()
  }
}))

jest.mock('@/lib/email/refund-notification', () => ({
  stageRefundNotificationEmail: jest.fn()
}))

import { POST } from '@/app/api/stripe-webhook/route'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe/server-client'
import { logger } from '@/lib/logging/logger'
import { NextRequest } from 'next/server'

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'test-signature' },
    body: '{}'
  })
}

function mockPaymentIntentSucceeded(metadata: Record<string, string>) {
  ;(getStripe as jest.Mock).mockReturnValue({
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test', amount: 10000, metadata } }
      })
    }
  })
}

// Mocks the xero_invoices lookup: `rows` are the app invoices matching the number.
function mockXeroInvoiceLookup(result: { data: unknown[] | null; error: unknown }) {
  const limit = jest.fn().mockResolvedValue(result)
  const eq = jest.fn().mockReturnValue({ limit })
  const select = jest.fn().mockReturnValue({ eq })
  const from = jest.fn().mockReturnValue({ select })
  ;(createAdminClient as jest.Mock).mockReturnValue({ from })
  return { from, eq }
}

describe('POST /api/stripe-webhook - payment_intent.succeeded without app metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockXeroInvoiceLookup({ data: [], error: null })
  })

  const logCalls = () => (logger.logPaymentProcessing as jest.Mock).mock.calls

  it('logs info (not error) and returns 200 for an external Xero invoice payment', async () => {
    mockPaymentIntentSucceeded({ EmailAddress: 'a@example.com', invoice: 'INV-10030' })

    const response = await POST(makeRequest())

    expect(response.status).toBe(200)
    expect(logger.logPaymentProcessing).toHaveBeenCalledWith(
      'payment-intent-external-xero-invoice',
      expect.any(String),
      expect.objectContaining({ paymentIntentId: 'pi_test', invoiceNumber: 'INV-10030' }),
      'info'
    )
    expect(logCalls().some(c => c[0] === 'payment-intent-missing-metadata')).toBe(false)
    expect(logCalls().some(c => c[3] === 'error')).toBe(false)
  })

  it('keeps logging an error when the invoice number is an app-synced invoice', async () => {
    const { from, eq } = mockXeroInvoiceLookup({ data: [{ id: 'xi-1' }], error: null })
    mockPaymentIntentSucceeded({ EmailAddress: 'a@example.com', invoice: 'INV-0042' })

    const response = await POST(makeRequest())

    expect(response.status).toBe(200)
    expect(from).toHaveBeenCalledWith('xero_invoices')
    expect(eq).toHaveBeenCalledWith('invoice_number', 'INV-0042')
    expect(logger.logPaymentProcessing).toHaveBeenCalledWith(
      'payment-intent-missing-metadata',
      expect.any(String),
      expect.objectContaining({ paymentIntentId: 'pi_test' }),
      'error'
    )
    expect(logCalls().some(c => c[0] === 'payment-intent-external-xero-invoice')).toBe(false)
  })

  it('fails safe (error log) when the app-invoice lookup fails', async () => {
    mockXeroInvoiceLookup({ data: null, error: { message: 'db down' } })
    mockPaymentIntentSucceeded({ EmailAddress: 'a@example.com', invoice: 'INV-10030' })

    await POST(makeRequest())

    expect(logCalls().some(c => c[0] === 'payment-intent-missing-metadata' && c[3] === 'error')).toBe(true)
    expect(logCalls().some(c => c[0] === 'payment-intent-external-xero-invoice')).toBe(false)
  })

  it('still logs an error when there is neither app metadata nor an invoice', async () => {
    mockPaymentIntentSucceeded({ EmailAddress: 'a@example.com' })

    const response = await POST(makeRequest())

    expect(response.status).toBe(200)
    expect(logger.logPaymentProcessing).toHaveBeenCalledWith(
      'payment-intent-missing-metadata',
      expect.any(String),
      expect.objectContaining({ paymentIntentId: 'pi_test' }),
      'error'
    )
    expect(logCalls().some(c => c[0] === 'payment-intent-external-xero-invoice')).toBe(false)
  })

  it('does not take the external-invoice path for an app payment that also carries an invoice key', async () => {
    mockPaymentIntentSucceeded({ userId: 'user-1', invoice: 'INV-1' })

    await POST(makeRequest()).catch(() => undefined)

    expect(logCalls().some(c => c[0] === 'payment-intent-external-xero-invoice')).toBe(false)
  })
})
