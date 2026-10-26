/**
 * Seasonal-limit accounting for discount refunds: usage (discount_usage_computed) already includes
 * the original invoice's checkout discount and earlier refund credit notes, so the requested refund
 * is checked on top of them exactly once. Also covers resolving a payment's season.
 */
jest.mock('@/lib/logging/logger', () => ({ logger: { logPaymentProcessing: jest.fn() } }))
import { checkSeasonalDiscountLimit } from '@/lib/services/discount-limit-service'
import { resolvePaymentSeasonId } from '@/lib/refunds/discount-refund-guards'

type Result = { data: unknown; error: unknown }
function db(byTable: Record<string, Result>) {
  return {
    from: jest.fn((table: string) => {
      const c: Record<string, unknown> = {}
      ;['select', 'eq', 'in'].forEach(m => { c[m] = jest.fn(() => c) })
      c.then = (res: (v: Result) => unknown) => Promise.resolve(byTable[table] ?? { data: [], error: null }).then(res)
      return c
    }),
  }
}

const code = { id: 'c', code: 'BOARD50', percentage: 50, uses_user_allowance: false, category: { id: 'cat', name: 'Board', max_discount_per_user_per_season: 5000, requires_user_allowance: false, default_percentage: null } }
const limit = { isEligible: true, percentage: 50, maxAllowed: 5000, source: 'category' } as never

describe('seasonal usage for refunds', () => {
  // Checkout discount on the original invoice ($20) + an earlier discount refund credit note ($10).
  const usage = { data: [{ amount_saved: 2000 }, { amount_saved: 1000 }], error: null }

  it('counts prior invoice discounts and earlier refunds once: under the limit', async () => {
    const r = await checkSeasonalDiscountLimit(db({ discount_usage_computed: usage }) as never, 'u', 'c', 's', 2000, { discountCode: code, effectiveLimit: limit })
    expect(r).toMatchObject({ finalAmount: 2000, isPartialDiscount: false, isAtLimit: false, seasonalUsage: { totalUsed: 3000, remaining: 2000 } })
  })

  it('over the limit: capped to the remaining room', async () => {
    const r = await checkSeasonalDiscountLimit(db({ discount_usage_computed: usage }) as never, 'u', 'c', 's', 2500, { discountCode: code, effectiveLimit: limit })
    expect(r).toMatchObject({ finalAmount: 2000, isPartialDiscount: true })
  })

  it('exactly at the limit: rejected', async () => {
    const r = await checkSeasonalDiscountLimit(db({ discount_usage_computed: { data: [{ amount_saved: 5000 }], error: null } }) as never, 'u', 'c', 's', 100, { discountCode: code, effectiveLimit: limit })
    expect(r).toMatchObject({ finalAmount: 0, isAtLimit: true })
  })

  it('a request that exactly fills the remaining room is not partial', async () => {
    const r = await checkSeasonalDiscountLimit(db({ discount_usage_computed: usage }) as never, 'u', 'c', 's', 2000, { discountCode: code, effectiveLimit: limit })
    expect(r.isPartialDiscount).toBe(false)
  })

  it('no category max (0/null) means unlimited', async () => {
    const r = await checkSeasonalDiscountLimit(db({}) as never, 'u', 'c', 's', 99999, { discountCode: code, effectiveLimit: { ...(limit as object), maxAllowed: 0 } as never })
    expect(r).toMatchObject({ finalAmount: 99999, isAtLimit: false })
  })

  it('throws (caller fails closed) when usage cannot be read', async () => {
    await expect(checkSeasonalDiscountLimit(db({ discount_usage_computed: { data: null, error: { message: 'boom' } } }) as never, 'u', 'c', 's', 100, { discountCode: code, effectiveLimit: limit })).rejects.toThrow()
  })
})

describe('resolvePaymentSeasonId', () => {
  it('uses the registration on user_registrations', async () => {
    expect(await resolvePaymentSeasonId(db({ user_registrations: { data: [{ registrations: { season_id: 's1' } }], error: null } }) as never, 'p')).toEqual({ status: 'ok', seasonId: 's1' })
  })
  it('falls back to the alternate selection (alternate payments have no user_registrations)', async () => {
    expect(await resolvePaymentSeasonId(db({ alternate_selections: { data: [{ alternate_registrations: { registrations: { season_id: 's2' } } }], error: null } }) as never, 'p')).toEqual({ status: 'ok', seasonId: 's2' })
  })
  it('missing / error', async () => {
    expect((await resolvePaymentSeasonId(db({}) as never, 'p')).status).toBe('missing')
    expect((await resolvePaymentSeasonId(db({ user_registrations: { data: null, error: { message: 'x' } } }) as never, 'p')).status).toBe('error')
  })
})
