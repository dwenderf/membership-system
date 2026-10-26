/**
 * #454: refund discount-code stacking rules in /api/validate-discount-code (isRefund: true).
 * - reusing a code already on the original invoice is invalid
 * - a different code is computed on the top-line (pre-discount) price
 * - the combined discount is capped at 100%: never more than paid / still refundable
 */
import { POST, capRefundDiscount } from '@/app/api/validate-discount-code/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/supabase/server')

type Result = { data: unknown; error: unknown }
function chain(result: Result) {
  const c: Record<string, unknown> = {}
  ;['select', 'eq', 'in'].forEach(m => { c[m] = jest.fn(() => c) })
  c.single = jest.fn(() => Promise.resolve(result))
  c.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c
}

const mockSupabase = { auth: { getUser: jest.fn() }, from: jest.fn() }
jest.requireMock('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(mockSupabase))

const code = (c: string, pct: number) => ({
  id: `id-${c}`, code: c, percentage: pct, uses_user_allowance: false, is_active: true,
  discount_categories: { id: 'cat', name: 'Board', accounting_code: 'A1', max_discount_per_user_per_season: null, is_active: true }
})

/**
 * Queue: registration, discount code, original invoice, lines for this specific code,
 * then all discount lines (prior total).
 */
function setup(newCode: ReturnType<typeof code>, priorLines: { line_amount: number }[], sameCodeLines: { id: string; line_amount: number }[]) {
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin' } }, error: null })
  const queue = [
    chain({ data: { season_id: 's1' }, error: null }),
    chain({ data: newCode, error: null }),
    chain({ data: [{ id: 'inv-1' }], error: null }),
    chain({ data: sameCodeLines, error: null }),
    chain({ data: priorLines, error: null }),
  ]
  mockSupabase.from.mockImplementation(() => queue.shift())
}

async function call(c: string, amount: number, availableAmount?: number) {
  const res = await POST(new NextRequest('http://localhost/api/validate-discount-code', {
    method: 'POST',
    body: JSON.stringify({ code: c, registrationId: 'reg', paymentId: 'pay', amount, availableAmount, isRefund: true })
  }))
  return res.json()
}

describe('#454 refund discount stacking', () => {
  beforeEach(() => jest.clearAllMocks())

  it('rejects reusing the code already applied (the $140 on INV-8494 case)', async () => {
    // $280 top-line, 50% code applied at checkout, paid $140
    setup(code('729BOARD50OFF', 50), [{ line_amount: -14000 }], [{ id: 'l1', line_amount: -14000 }])
    const data = await call('729BOARD50OFF', 14000, 14000)
    expect(data.isValid).toBe(false)
    expect(data.alreadyApplied).toBe(true)
    expect(data.error).toContain('729BOARD50OFF was already applied')
  })

  it('stacks a different code computed on the full (top-line) price', async () => {
    // $280 top-line, 50% already used, new 25% => 25% of $280 = $70 (not 25% of $140 = $35)
    setup(code('EXTRA25', 25), [{ line_amount: -14000 }], [])
    const data = await call('EXTRA25', 14000, 14000)
    expect(data.isValid).toBe(true)
    expect(data.discountAmount).toBe(7000)
  })

  it('caps the combined discount at 100% (50% used + new 75% => refund only the $140 paid)', async () => {
    setup(code('BIG75', 75), [{ line_amount: -14000 }], [])
    const data = await call('BIG75', 14000, 14000)
    expect(data.isValid).toBe(true)
    expect(data.discountAmount).toBe(14000)
  })

  it('caps at the remaining refundable amount after prior refunds', async () => {
    setup(code('BIG75', 75), [{ line_amount: -14000 }], [])
    const data = await call('BIG75', 14000, 4000)
    expect(data.discountAmount).toBe(4000)
  })

  it('no prior discount: percentage on the paid amount (unchanged behaviour)', async () => {
    setup(code('HALF', 50), [], [])
    const data = await call('HALF', 5000, 5000)
    expect(data.discountAmount).toBe(2500)
  })

  it('capRefundDiscount', () => {
    expect(capRefundDiscount(21000, 14000)).toBe(14000)
    expect(capRefundDiscount(21000, 14000, 3000)).toBe(3000)
    expect(capRefundDiscount(500, 14000, 14000)).toBe(500)
    expect(capRefundDiscount(-1, 100)).toBe(0)
  })
})
