/**
 * #410 payload tests: DATE columns in email payloads must not shift a day on
 * UTC hosts. Covers payment-plan-processor (processed + failed emails) and the
 * waitlist season label used by POST /api/join-waitlist.
 */
const mockStageEmail = jest.fn(() => Promise.resolve(true))
jest.mock('@/lib/email/staging', () => ({ emailStagingManager: { stageEmail: (...a: unknown[]) => mockStageEmail(...a) } }))
jest.mock('@/lib/logging/logger', () => ({ logger: { logBatchProcessing: jest.fn(), logSystem: jest.fn() } }))
const mockStageAdmin = jest.fn(() => Promise.resolve())
jest.mock('@/lib/email/admin-notifications', () => ({ stageAdminPaymentPlanFailureNotification: (arg: unknown) => mockStageAdmin(arg) }))
const mockProcessTxn = jest.fn()
jest.mock('@/lib/services/payment-plan-service', () => ({
  PaymentPlanService: { processPaymentPlanTransaction: (...a: unknown[]) => mockProcessTxn(...a) },
}))

const tableData: Record<string, unknown> = {}
jest.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const result = () => ({ data: tableData[table] ?? null, error: null })
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'lte', 'gte', 'in', 'order', 'limit', 'update', 'insert']) chain[m] = () => chain
      chain.single = () => Promise.resolve(result())
      chain.maybeSingle = () => Promise.resolve(result())
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej)
      return chain
    },
  }),
}))

import { processDuePayments } from '@/lib/services/payment-plan-processor'
import { formatSeasonWithDates } from '@/lib/email/season-label'

const ZONES = ['UTC', 'America/New_York', 'Pacific/Kiritimati']
const ORIGINAL_TZ = process.env.TZ
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

function seed() {
  tableData.xero_payments = [{
    id: 'xp-1', installment_number: 2, attempt_count: 0, amount_paid: 5000,
    planned_payment_date: '2026-11-11',
    xero_invoice: { id: 'inv-1', user_registrations: [{ user_id: 'u-1', registration: { name: 'Rec League', season: { name: 'S' } } }] },
  }]
  tableData.users = { email: 'member@example.com', first_name: 'A', last_name: 'B' }
  tableData.payment_plan_summary = {
    status: 'active', total_installments: 4, paid_amount: 10000, total_amount: 20000,
    next_payment_date: '2026-12-01',
  }
}
const stagedData = (eventType: string) => {
  const call = mockStageEmail.mock.calls.find((c) => (c[0] as { event_type: string }).event_type === eventType)
  return (call?.[0] as { email_data: Record<string, unknown> } | undefined)?.email_data
}

describe.each(ZONES)('DATE values in email payloads (host TZ=%s)', (zone) => {
  beforeEach(() => {
    process.env.TZ = zone
    jest.clearAllMocks()
    seed()
  })

  it('admin failure alert: scheduledDate, amountPaid and remainingBalance match the member email', async () => {
    mockProcessTxn.mockResolvedValueOnce({ success: false, error: 'card_declined' })
    await processDuePayments('2026-11-11')
    expect(mockStageAdmin).toHaveBeenCalledTimes(1)
    expect(mockStageAdmin.mock.calls[0][0] as Record<string, unknown>).toMatchObject({
      scheduledDate: '11/11/2026',
      amountPaidCents: 10000,
      remainingBalanceCents: 10000,
    })
  })

  it('payment processed email: next_payment_date is the calendar day', async () => {
    mockProcessTxn.mockResolvedValueOnce({ success: true, paymentId: 'p-1' })
    await processDuePayments('2026-11-11')
    expect(stagedData('payment_plan.payment_processed')).toMatchObject({ next_payment_date: '12/1/2026' })
  })

  it('payment failed email: scheduled_date is the calendar day', async () => {
    mockProcessTxn.mockResolvedValueOnce({ success: false, error: 'card_declined' })
    await processDuePayments('2026-11-11')
    expect(stagedData('payment_plan.payment_failed')).toMatchObject({ scheduled_date: '11/11/2026' })
  })

  it('waitlist season label shows season start/end unchanged', () => {
    expect(formatSeasonWithDates({ name: 'Fall/Winter 2026', start_date: '2026-09-01', end_date: '2027-03-31' }))
      .toBe('Fall/Winter 2026 (9/1/2026 - 3/31/2027)')
    expect(formatSeasonWithDates(null)).toBe('Unknown Season')
  })
})
