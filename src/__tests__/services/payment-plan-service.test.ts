/**
 * Tests for Payment Plan Service
 */

import { PaymentPlanService } from '@/lib/services/payment-plan-service'
import { createAdminClient } from '@/lib/supabase/server'
import { PAYMENT_PLAN_INSTALLMENTS } from '@/lib/services/payment-plan-config'

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn()
}))
jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logPaymentProcessing: jest.fn()
  }
}))
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({}))
})

describe('PaymentPlanService', () => {
  describe('createPaymentPlan - Installment Amount Distribution', () => {
    let mockAdminSupabase: any
    let mockInsertedPayments: any[]

    beforeEach(() => {
      jest.clearAllMocks()

      mockInsertedPayments = []

      // Mock the Supabase admin client
      mockAdminSupabase = {
        from: jest.fn((table: string) => {
          if (table === 'xero_invoices') {
            return {
              update: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ error: null })
              })
            }
          }
          if (table === 'xero_payments') {
            return {
              insert: jest.fn((payments: any[]) => {
                mockInsertedPayments = payments
                return Promise.resolve({ error: null })
              })
            }
          }
          return {}
        })
      }

      ;(createAdminClient as jest.Mock).mockReturnValue(mockAdminSupabase)
    })

    it('should distribute amounts evenly when total divides perfectly', async () => {
      const totalAmount = 10000 // 10000 / 4 = 2500 (perfect division)

      await PaymentPlanService.createPaymentPlan({
        userId: 'user-id',
        userRegistrationId: 'reg-id',
        xeroInvoiceId: 'invoice-id',
        tenantId: 'tenant-id',
        totalAmount,
        firstPaymentId: 'payment-id'
      })

      expect(mockInsertedPayments).toHaveLength(PAYMENT_PLAN_INSTALLMENTS)

      // All installments should be equal
      expect(mockInsertedPayments[0].amount_paid).toBe(2500)
      expect(mockInsertedPayments[1].amount_paid).toBe(2500)
      expect(mockInsertedPayments[2].amount_paid).toBe(2500)
      expect(mockInsertedPayments[3].amount_paid).toBe(2500)

      // Total should match exactly
      const total = mockInsertedPayments.reduce((sum, p) => sum + p.amount_paid, 0)
      expect(total).toBe(totalAmount)
    })

    it('should handle rounding remainder in last installment (case 1: +1 cent)', async () => {
      const totalAmount = 10001 // 10001 / 4 = 2500.25 → rounds to 2500

      await PaymentPlanService.createPaymentPlan({
        userId: 'user-id',
        userRegistrationId: 'reg-id',
        xeroInvoiceId: 'invoice-id',
        tenantId: 'tenant-id',
        totalAmount,
        firstPaymentId: 'payment-id'
      })

      expect(mockInsertedPayments).toHaveLength(PAYMENT_PLAN_INSTALLMENTS)

      // First 3 installments should be 2500
      expect(mockInsertedPayments[0].amount_paid).toBe(2500)
      expect(mockInsertedPayments[1].amount_paid).toBe(2500)
      expect(mockInsertedPayments[2].amount_paid).toBe(2500)

      // Last installment should absorb the remainder
      expect(mockInsertedPayments[3].amount_paid).toBe(2501) // 10001 - (2500 * 3) = 2501

      // Total should match exactly
      const total = mockInsertedPayments.reduce((sum, p) => sum + p.amount_paid, 0)
      expect(total).toBe(totalAmount)
    })

    it('should handle rounding remainder in last installment (case 2: +2 cents)', async () => {
      const totalAmount = 10002 // 10002 / 4 = 2500.5 → rounds to 2501

      await PaymentPlanService.createPaymentPlan({
        userId: 'user-id',
        userRegistrationId: 'reg-id',
        xeroInvoiceId: 'invoice-id',
        tenantId: 'tenant-id',
        totalAmount,
        firstPaymentId: 'payment-id'
      })

      expect(mockInsertedPayments).toHaveLength(PAYMENT_PLAN_INSTALLMENTS)

      // First 3 installments should be 2501 (rounded up from 2500.5)
      expect(mockInsertedPayments[0].amount_paid).toBe(2501)
      expect(mockInsertedPayments[1].amount_paid).toBe(2501)
      expect(mockInsertedPayments[2].amount_paid).toBe(2501)

      // Last installment should absorb the remainder
      expect(mockInsertedPayments[3].amount_paid).toBe(2499) // 10002 - (2501 * 3) = 2499

      // Total should match exactly
      const total = mockInsertedPayments.reduce((sum, p) => sum + p.amount_paid, 0)
      expect(total).toBe(totalAmount)
    })

    it('should handle rounding remainder in last installment (case 3: +3 cents)', async () => {
      const totalAmount = 10003 // 10003 / 4 = 2500.75 → rounds to 2501

      await PaymentPlanService.createPaymentPlan({
        userId: 'user-id',
        userRegistrationId: 'reg-id',
        xeroInvoiceId: 'invoice-id',
        tenantId: 'tenant-id',
        totalAmount,
        firstPaymentId: 'payment-id'
      })

      expect(mockInsertedPayments).toHaveLength(PAYMENT_PLAN_INSTALLMENTS)

      // First 3 installments should be 2501 (rounded up)
      expect(mockInsertedPayments[0].amount_paid).toBe(2501)
      expect(mockInsertedPayments[1].amount_paid).toBe(2501)
      expect(mockInsertedPayments[2].amount_paid).toBe(2501)

      // Last installment should be the remainder
      expect(mockInsertedPayments[3].amount_paid).toBe(2500) // 10003 - (2501 * 3) = 2500

      // Total should match exactly
      const total = mockInsertedPayments.reduce((sum, p) => sum + p.amount_paid, 0)
      expect(total).toBe(totalAmount)
    })

    it('should handle various odd amounts correctly', async () => {
      const testCases = [
        1234,    // 1234 / 4 = 308.5 → 308
        9999,    // 9999 / 4 = 2499.75 → 2500
        15007,   // 15007 / 4 = 3751.75 → 3752
        1,       // Edge case: 1 / 4 = 0.25 → 0
        3        // Edge case: 3 / 4 = 0.75 → 1
      ]

      for (const totalAmount of testCases) {
        mockInsertedPayments = []

        await PaymentPlanService.createPaymentPlan({
          userId: 'user-id',
          userRegistrationId: 'reg-id',
          xeroInvoiceId: 'invoice-id',
          tenantId: 'tenant-id',
          totalAmount,
          firstPaymentId: 'payment-id'
        })

        // Total should always match exactly
        const total = mockInsertedPayments.reduce((sum, p) => sum + p.amount_paid, 0)
        expect(total).toBe(totalAmount)
      }
    })

    it('should verify installment metadata is set correctly', async () => {
      const totalAmount = 10001

      await PaymentPlanService.createPaymentPlan({
        userId: 'test-user-id',
        userRegistrationId: 'test-reg-id',
        xeroInvoiceId: 'test-invoice-id',
        tenantId: 'test-tenant-id',
        totalAmount,
        firstPaymentId: 'test-payment-id'
      })

      // Verify all payments have correct metadata
      mockInsertedPayments.forEach((payment, index) => {
        expect(payment.installment_number).toBe(index + 1)
        expect(payment.sync_status).toBe('staged')
        expect(payment.payment_type).toBe('installment')
        expect(payment.staging_metadata.user_id).toBe('test-user-id')
        expect(payment.staging_metadata.user_registration_id).toBe('test-reg-id')

        // Only first payment should have first_payment_id
        if (index === 0) {
          expect(payment.staging_metadata.first_payment_id).toBe('test-payment-id')
        } else {
          expect(payment.staging_metadata.first_payment_id).toBeUndefined()
        }
      })
    })
  })
})
