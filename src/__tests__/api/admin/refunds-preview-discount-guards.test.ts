/**
 * #454: /api/admin/refunds/preview re-checks the original invoice and code reuse before staging,
 * instead of trusting the client's discountValidation.isValid.
 */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('@/lib/logging/logger', () => ({ logger: { logPaymentProcessing: jest.fn() } }))
jest.mock('@/lib/xero/staging', () => ({ xeroStagingManager: { createRefundStaging: jest.fn() } }))

jest.mock('@/lib/refunds/discount-refund-guards', () => ({
  ...jest.requireActual('@/lib/refunds/discount-refund-guards'),
  resolvePaymentSeasonId: jest.fn(),
}))
jest.mock('@/lib/services/discount-limit-service', () => ({
  ...jest.requireActual('@/lib/services/discount-limit-service'),
  checkSeasonalDiscountLimit: jest.fn(),
}))
import { resolvePaymentSeasonId } from '@/lib/refunds/discount-refund-guards'
import { checkSeasonalDiscountLimit } from '@/lib/services/discount-limit-service'
const seasonMock = resolvePaymentSeasonId as jest.Mock
const limitMock = checkSeasonalDiscountLimit as jest.Mock
import { POST } from '@/app/api/admin/refunds/preview/route'
import { createClient } from '@/lib/supabase/server'
import { xeroStagingManager } from '@/lib/xero/staging'
import { NextRequest } from 'next/server'

type Result = { data: unknown; error: unknown }
function chain(result: Result) {
  const c: Record<string, unknown> = {}
  ;['select', 'eq', 'in'].forEach(m => { c[m] = jest.fn(() => c) })
  c.single = jest.fn(() => Promise.resolve(result))
  c.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c
}

const ok = (data: unknown): Result => ({ data, error: null })
const staging = xeroStagingManager.createRefundStaging as jest.Mock

function setup(rest: Result[]) {
  const q = [
    ok({ is_admin: true }),                         // users
    ok({ id: 'pay', user_id: 'cust', status: 'completed', final_amount: 14000 }), // payments
    ok([{ id: 'ur' }]),                             // user_registrations
    ok([]),                                         // refunds
    ...rest,
  ]
  ;(createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'admin' } } }) },
    from: jest.fn(() => chain(q.shift() as Result)),
  })
}

const validation = {
  isValid: true,
  discountAmount: 3500,
  discountCode: { id: 'c1', code: 'NEW25', percentage: 25, category: { id: 'cat', name: 'Board', accounting_code: 'A1' } },
}

async function preview() {
  const res = await POST(new NextRequest('http://localhost/api/admin/refunds/preview', {
    method: 'POST',
    body: JSON.stringify({ paymentId: 'pay', refundType: 'discount_code', discountValidation: validation }),
  }))
  return { status: res.status, body: await res.json() }
}

describe('refund preview discount guards (#454)', () => {
  beforeEach(() => {
    staging.mockReset()
    seasonMock.mockReset().mockResolvedValue({ status: 'ok', seasonId: 's1' })
    limitMock.mockReset().mockImplementation((_s: unknown, _u: string, _c: string, _season: string, requested: number) =>
      Promise.resolve({ originalAmount: requested, finalAmount: requested, isPartialDiscount: false, isAtLimit: false }))
  })

  it('rejects when the original invoice is missing, before staging', async () => {
    setup([ok([])])
    const { status, body } = await preview()
    expect(status).toBe(400)
    expect(body.missingOriginalInvoice).toBe(true)
    expect(body.error).toContain('original invoice')
    expect(staging).not.toHaveBeenCalled()
  })

  it('rejects a code already on the original invoice', async () => {
    setup([ok([{ id: 'inv' }]), ok([{ id: 'l1', line_amount: -7000 }])])
    const { status, body } = await preview()
    expect(status).toBe(400)
    expect(body.alreadyApplied).toBe(true)
    expect(staging).not.toHaveBeenCalled()
  })

  it('rejects a code used in an earlier refund on the payment', async () => {
    setup([ok([{ id: 'inv' }]), ok([]), ok([line('synced', null)])])
    const { status, body } = await preview()
    expect(status).toBe(400)
    expect(body.error).toContain('earlier refund')
    expect(staging).not.toHaveBeenCalled()
  })

  // #456 review: used once a refund is initiated, freed only when it failed/was cancelled.
  it.each([
    ['staged refund', 'staged', 'pending', false],
    ['pending refund', 'pending', 'pending', false],
    ['credit note not yet synced', 'failed', 'completed', false],
    ['failed refund', 'ignore', 'failed', true],
    ['canceled refund', 'ignore', 'cancelled', true],
  ])('earlier %s', async (_n, sync, refundStatus, freed) => {
    staging.mockResolvedValue('stg')
    setup([ok([{ id: 'inv' }]), ok([]), ok([line(sync as string, 'r1')]), ok([{ id: 'r1', status: refundStatus }]), ok({ id: 'stg', total_amount: 3500, xero_invoice_line_items: [] })])
    const { status, body } = await preview()
    if (freed) {
      expect(status).toBe(200)
      expect(staging).toHaveBeenCalledTimes(1)
    } else {
      expect(status).toBe(400)
      expect(body.error).toContain('earlier refund')
      expect(staging).not.toHaveBeenCalled()
    }
  })

  it('fails closed when the reuse lookup errors', async () => {
    setup([ok([{ id: 'inv' }]), { data: null, error: { message: 'boom' } }])
    const { status, body } = await preview()
    expect(status).toBe(503)
    expect(body.reuseCheckFailed).toBe(true)
    expect(staging).not.toHaveBeenCalled()
  })

  it('stages when the invoice exists and the code is unused', async () => {
    setup([ok([{ id: 'inv' }]), ok([]), ok([]), ok({ id: 'stg', total_amount: 3500, xero_invoice_line_items: [] })])
    staging.mockResolvedValue('stg')
    const { status, body } = await preview()
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(staging).toHaveBeenCalledTimes(1)
  })
})

describe('refund preview seasonal limit (server re-check)', () => {
  beforeEach(() => {
    staging.mockReset().mockResolvedValue('stg')
    seasonMock.mockReset().mockResolvedValue({ status: 'ok', seasonId: 's1' })
    limitMock.mockReset()
  })
  const unusedCode = () => setup([ok([{ id: 'inv' }]), ok([]), ok([]), ok({ id: 'stg', total_amount: 3500, xero_invoice_line_items: [] })])

  it('stages when the amount is within the remaining seasonal room', async () => {
    unusedCode()
    limitMock.mockResolvedValue({ originalAmount: 3500, finalAmount: 3500, isPartialDiscount: false, isAtLimit: false })
    const { status } = await preview()
    expect(status).toBe(200)
    expect(limitMock).toHaveBeenCalledWith(expect.anything(), 'cust', 'c1', 's1', 3500)
    expect(staging).toHaveBeenCalledTimes(1)
  })

  it('rejects a client amount above the remaining seasonal room (bypass)', async () => {
    unusedCode()
    limitMock.mockResolvedValue({ originalAmount: 3500, finalAmount: 1000, isPartialDiscount: true, isAtLimit: false })
    const { status, body } = await preview()
    expect(status).toBe(400)
    expect(body.seasonalLimitExceeded).toBe(true)
    expect(body.error).toContain('remaining seasonal discount of $10.00')
    expect(staging).not.toHaveBeenCalled()
  })

  it('rejects when the customer is already at the limit', async () => {
    unusedCode()
    limitMock.mockResolvedValue({ originalAmount: 3500, finalAmount: 0, isPartialDiscount: false, isAtLimit: true, seasonalUsage: { totalUsed: 5000, remaining: 0, maxAllowed: 5000 } })
    const { status, body } = await preview()
    expect(status).toBe(400)
    expect(body.error).toContain('$50.00 season limit')
    expect(staging).not.toHaveBeenCalled()
  })

  it('fails closed (503) when the limit check errors', async () => {
    unusedCode()
    limitMock.mockRejectedValue(new Error('usage query failed'))
    const { status } = await preview()
    expect(status).toBe(503)
    expect(staging).not.toHaveBeenCalled()
  })

  it('rejects when the season cannot be determined; 503 on a lookup error', async () => {
    unusedCode()
    seasonMock.mockResolvedValue({ status: 'missing' })
    expect((await preview()).status).toBe(400)
    unusedCode()
    seasonMock.mockResolvedValue({ status: 'error' })
    expect((await preview()).status).toBe(503)
    expect(staging).not.toHaveBeenCalled()
  })
})

function line(sync_status: string, refund_id: string | null) {
  return { id: 'cn-line', xero_invoices: { payment_id: 'pay', invoice_type: 'ACCRECCREDIT', sync_status, staging_metadata: { refund_id } } }
}
