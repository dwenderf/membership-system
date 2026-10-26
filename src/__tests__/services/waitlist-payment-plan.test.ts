/**
 * Waitlist payment plans (#442): chargeWaitlistUser charges installment 1 when the member chose
 * a plan and is still eligible, and falls back to a full charge when they aren't.
 */

process.env.STRIPE_SECRET_KEY = 'sk_test_mock_123'
process.env.STRIPE_API_VERSION = '2026-09-30.endive'

const mockPaymentIntentsCreate = jest.fn()

jest.mock('stripe', () => {
  class MockStripe {
    paymentIntents = { create: mockPaymentIntentsCreate }
  }
  return Object.assign(MockStripe, { default: MockStripe, __esModule: true })
})

jest.mock('@/lib/logging/logger', () => ({
  logger: { logPaymentProcessing: jest.fn() },
  Logger: { getInstance: jest.fn().mockReturnValue({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
}))

jest.mock('@/lib/xero/staging', () => ({
  xeroStagingManager: {
    createImmediateStaging: jest.fn().mockResolvedValue({ id: 'staging-1', staging_metadata: {} })
  },
  StagingPaymentData: {}
}))

jest.mock('@/lib/payment-completion-processor', () => ({
  PaymentCompletionProcessor: jest.fn().mockImplementation(() => ({ processPaymentCompletion: jest.fn() }))
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn()
}))

import { WaitlistPaymentService } from '@/lib/services/waitlist-payment-service'
import { xeroStagingManager } from '@/lib/xero/staging'
import { createClient, createAdminClient } from '@/lib/supabase/server'

interface MockUser {
  stripe_payment_method_id: string | null
  stripe_customer_id: string
  payment_plan_enabled: boolean
}

let paymentsInsert: jest.Mock

function mockDb(user: MockUser, price = 10000) {
  paymentsInsert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: { id: 'payment-1' }, error: null })
    })
  })

  const single = (data: unknown) => ({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data, error: null }) })
    })
  })

  const client = {
    from: jest.fn((table: string) => {
      switch (table) {
        case 'users':
          return single({ ...user, email: 'm@example.com', first_name: 'Max', last_name: 'Member', setup_intent_status: 'succeeded' })
        case 'registrations':
          return single({ name: 'Fall League', season_id: 'season-1' })
        case 'registration_categories':
          return single({ price, accounting_code: 'REG' })
        case 'xero_invoices':
          return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) }) }
        case 'payments':
          return { insert: paymentsInsert }
        default:
          return {}
      }
    })
  }

  ;(createClient as jest.Mock).mockResolvedValue(client)
  ;(createAdminClient as jest.Mock).mockReturnValue(client)
}

const eligibleUser: MockUser = { stripe_payment_method_id: 'pm_1', stripe_customer_id: 'cus_1', payment_plan_enabled: true }

function charge(usePaymentPlan?: boolean, overridePrice?: number) {
  return WaitlistPaymentService.chargeWaitlistUser(
    'user-1', 'reg-1', 'cat-1', 'Skater', undefined, overridePrice,
    usePaymentPlan === undefined ? undefined : { usePaymentPlan }
  )
}

describe('WaitlistPaymentService.chargeWaitlistUser - payment plans (#442)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPaymentIntentsCreate.mockResolvedValue({ id: 'pi_1', status: 'succeeded' })
  })

  it('charges the first of 4 installments with plan metadata when the member chose a plan and is eligible', async () => {
    mockDb(eligibleUser, 10050)

    const result = await charge(true)

    const params = mockPaymentIntentsCreate.mock.calls[0][0]
    expect(params.amount).toBe(2513) // Math.round(10050 / 4)
    expect(params.metadata).toMatchObject({
      purpose: 'waitlist_selection',
      isPaymentPlan: 'true',
      paymentPlanTotalAmount: '10050',
      paymentPlanInstallmentAmount: '2513',
      xeroStagingRecordId: 'staging-1'
    })
    expect(params.description).toMatch(/^Payment Plan \(1\/4\)/)
    expect(xeroStagingManager.createImmediateStaging).toHaveBeenCalledWith(
      expect.objectContaining({ final_amount: 10050 }),
      { isFree: false, isPaymentPlan: true }
    )
    expect(paymentsInsert).toHaveBeenCalledWith(expect.objectContaining({ total_amount: 10050, final_amount: 2513 }))
    expect(result).toMatchObject({
      success: true,
      amountCharged: 2513,
      totalAmount: 10050,
      isPaymentPlan: true,
      paymentPlanFallback: false,
      xeroInvoiceId: 'staging-1'
    })
  })

  it('splits the override price, not the category price', async () => {
    mockDb(eligibleUser, 10000)

    const result = await charge(true, 8000)

    expect(mockPaymentIntentsCreate.mock.calls[0][0].amount).toBe(2000)
    expect(result.totalAmount).toBe(8000)
  })

  it('charges in full when the member chose a plan but plan access was turned off', async () => {
    mockDb({ ...eligibleUser, payment_plan_enabled: false })

    const result = await charge(true)

    const params = mockPaymentIntentsCreate.mock.calls[0][0]
    expect(params.amount).toBe(10000)
    expect(params.metadata.isPaymentPlan).toBeUndefined()
    expect(xeroStagingManager.createImmediateStaging).toHaveBeenCalledWith(expect.anything(), { isFree: false, isPaymentPlan: false })
    expect(result).toMatchObject({ amountCharged: 10000, isPaymentPlan: false, paymentPlanFallback: true })
  })

  it('charges in full when the member did not choose a plan (regression)', async () => {
    mockDb(eligibleUser)

    const result = await charge(false)

    const params = mockPaymentIntentsCreate.mock.calls[0][0]
    expect(params.amount).toBe(10000)
    expect(params.metadata.isPaymentPlan).toBeUndefined()
    expect(params.description).toBe('Waitlist Selection: Fall League - Skater')
    expect(result).toMatchObject({ amountCharged: 10000, isPaymentPlan: false, paymentPlanFallback: false })
  })

  it('defaults to a full charge when no options are passed', async () => {
    mockDb(eligibleUser)

    const result = await charge(undefined)

    expect(mockPaymentIntentsCreate.mock.calls[0][0].amount).toBe(10000)
    expect(result.isPaymentPlan).toBe(false)
  })

  it('never creates a plan for a free selection', async () => {
    mockDb(eligibleUser)

    const result = await charge(true, 0)

    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled()
    expect(xeroStagingManager.createImmediateStaging).toHaveBeenCalledWith(expect.anything(), { isFree: true, isPaymentPlan: false })
    expect(result).toMatchObject({ amountCharged: 0, isPaymentPlan: false, paymentPlanFallback: false })
  })
})
