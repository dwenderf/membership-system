/**
 * #454: /api/admin/refunds/preview re-checks the original invoice and code reuse before staging,
 * instead of trusting the client's discountValidation.isValid.
 */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('@/lib/logging/logger', () => ({ logger: { logPaymentProcessing: jest.fn() } }))
jest.mock('@/lib/xero/staging', () => ({ xeroStagingManager: { createRefundStaging: jest.fn() } }))

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
    ok({ id: 'pay', status: 'completed', final_amount: 14000 }), // payments
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
  beforeEach(() => staging.mockReset())

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
    setup([ok([{ id: 'inv' }]), ok([]), ok([{ id: 'cn-line' }])])
    const { status, body } = await preview()
    expect(status).toBe(400)
    expect(body.error).toContain('earlier refund')
    expect(staging).not.toHaveBeenCalled()
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
