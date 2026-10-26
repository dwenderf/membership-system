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
 * this code on earlier refund credit notes, then all discount lines (prior total).
 */
function setup(newCode: ReturnType<typeof code>, priorLines: { line_amount: number }[], sameCodeLines: { id: string; line_amount: number }[], refundLines: { id: string }[] = []) {
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin' } }, error: null })
  const queue = [
    chain({ data: { season_id: 's1' }, error: null }),
    chain({ data: newCode, error: null }),
    chain({ data: [{ id: 'inv-1' }], error: null }),
    chain({ data: sameCodeLines, error: null }),
    chain({ data: refundLines, error: null }),
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

  describe('#454 (b): original invoice missing => no paid-amount fallback', () => {
    function queue(invoiceResult: Result, extra: Result[] = []) {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin' } }, error: null })
      const q = [
        chain({ data: { season_id: 's1' }, error: null }),
        chain({ data: code('NEWCODE', 25), error: null }),
        chain(invoiceResult),
        ...extra.map(chain),
      ]
      mockSupabase.from.mockImplementation(() => q.shift())
    }
    const expectMissing = (data: Record<string, unknown>) => {
      expect(data.isValid).toBe(false)
      expect(data.missingOriginalInvoice).toBe(true)
      expect(data.discountAmount).toBeUndefined()
      expect(data.error).toContain('original invoice')
    }

    it('rejects when no original invoice is found', async () => {
      queue({ data: [], error: null })
      expectMissing(await call('NEWCODE', 10000, 10000))
    })

    it('rejects when the invoice query errors', async () => {
      queue({ data: null, error: { message: 'boom' } })
      expectMissing(await call('NEWCODE', 10000, 10000))
    })

    it('rejects when the original invoice discount lines cannot be read', async () => {
      queue({ data: [{ id: 'inv-1' }], error: null }, [{ data: [], error: null }, { data: [], error: null }, { data: null, error: { message: 'boom' } }])
      expectMissing(await call('NEWCODE', 10000, 10000))
    })

    it('rejects when no paymentId is sent', async () => {
      queue({ data: [], error: null })
      const res = await POST(new NextRequest('http://localhost/api/validate-discount-code', {
        method: 'POST',
        body: JSON.stringify({ code: 'NEWCODE', registrationId: 'reg', amount: 10000, isRefund: true })
      }))
      expectMissing(await res.json())
    })
  })

  describe('reuse and lookup errors fail closed', () => {
    function queueWith(lines: Result, refundLines?: Result, refunds?: Result) {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin' } }, error: null })
      const q = [
        chain({ data: { season_id: 's1' }, error: null }),
        chain({ data: code('NEWCODE', 25), error: null }),
        chain({ data: [{ id: 'inv-1' }], error: null }),
        chain(lines),
        ...(refundLines ? [chain(refundLines)] : []),
        ...(refunds ? [chain(refunds)] : []),
        chain({ data: [], error: null }),
      ]
      mockSupabase.from.mockImplementation(() => q.shift())
    }

    it('rejects when the original-invoice reuse lookup errors', async () => {
      queueWith({ data: null, error: { message: 'boom' } })
      const data = await call('NEWCODE', 10000, 10000)
      expect(data.isValid).toBe(false)
      expect(data.reuseCheckFailed).toBe(true)
      expect(data.discountAmount).toBeUndefined()
    })

    it('rejects when the earlier-refund reuse lookup errors', async () => {
      queueWith({ data: [], error: null }, { data: null, error: { message: 'boom' } })
      const data = await call('NEWCODE', 10000, 10000)
      expect(data.isValid).toBe(false)
      expect(data.reuseCheckFailed).toBe(true)
    })

    it('rejects a code already applied in an earlier refund on the same payment', async () => {
      queueWith({ data: [], error: null }, { data: [creditNoteLine('synced', null)], error: null })
      const data = await call('NEWCODE', 10000, 7500)
      expect(data.isValid).toBe(false)
      expect(data.alreadyApplied).toBe(true)
      expect(data.error).toContain('earlier refund')
    })

  // #456 review: a code is used once a refund is initiated, whatever the credit note's sync
  // state, and freed only when the refund is failed/cancelled.
  describe('earlier refund status decides reuse (#456)', () => {
    const cases: [string, string, string, boolean][] = [
      ['staged refund (credit note staged)', 'staged', 'pending', false],
      ['pending refund', 'pending', 'pending', false],
      ['credit note not yet synced (failed sync, refund completed)', 'failed', 'completed', false],
      ['failed refund', 'ignore', 'failed', true],
      ['canceled refund', 'ignore', 'cancelled', true],
    ]
    it.each(cases)('%s', async (_n, syncStatus, refundStatus, freed) => {
      queueWith({ data: [], error: null }, { data: [creditNoteLine(syncStatus, 'r1')], error: null }, { data: [{ id: 'r1', status: refundStatus }], error: null })
      const data = await call('NEWCODE', 10000, 7500)
      expect(data.isValid).toBe(freed)
      if (!freed) expect(data.error).toContain('earlier refund')
    })

    it('ignores an unconfirmed preview credit note (no refund initiated)', async () => {
      queueWith({ data: [], error: null }, { data: [creditNoteLine('staged', null)], error: null })
      const data = await call('NEWCODE', 10000, 7500)
      expect(data.isValid).toBe(true)
    })

    it('fails closed when the referenced refund row is missing', async () => {
      queueWith({ data: [], error: null }, { data: [creditNoteLine('staged', 'r1')], error: null }, { data: [], error: null })
      const data = await call('NEWCODE', 10000, 7500)
      expect(data.isValid).toBe(false)
    })
  })
  })

  describe('odd-cent rounding', () => {
    it('rounds a percentage of an odd amount to the nearest cent', async () => {
      setup(code('PCT15', 15), [], [])
      const data = await call('PCT15', 9999, 9999) // 1499.85 -> 1500
      expect(data.isValid).toBe(true)
      expect(data.discountAmount).toBe(1500)
    })

    it('rounds half a cent up when stacking on an odd top-line price', async () => {
      setup(code('HALF', 50), [{ line_amount: -1 }], []) // top-line 10001, 50% = 5000.5 -> 5001
      const data = await call('HALF', 10000, 10000)
      expect(data.discountAmount).toBe(5001)
    })
  })

  it('capRefundDiscount', () => {
    expect(capRefundDiscount(21000, 14000)).toBe(14000)
    expect(capRefundDiscount(21000, 14000, 3000)).toBe(3000)
    expect(capRefundDiscount(500, 14000, 14000)).toBe(500)
    expect(capRefundDiscount(-1, 100)).toBe(0)
  })
})

function creditNoteLine(sync_status: string, refund_id: string | null) {
  return { id: 'cn-line', xero_invoices: { payment_id: 'pay', invoice_type: 'ACCRECCREDIT', sync_status, staging_metadata: { refund_id } } }
}
