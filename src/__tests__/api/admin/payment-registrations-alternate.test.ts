/** #454 bug 1: alternate-selection payments expose discount-code refund context. */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createAdminClient: jest.fn() }))
jest.mock('@/lib/logging/logger', () => ({ logger: { logAdminAction: jest.fn() } }))

import { GET } from '@/app/api/admin/payments/[paymentId]/registrations/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

type Result = { data: unknown; error: unknown }
function chain(result: Result) {
  const c: Record<string, unknown> = {}
  ;['select', 'eq', 'in'].forEach(m => { c[m] = jest.fn(() => c) })
  c.single = jest.fn(() => Promise.resolve(result))
  c.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c
}
function fromQueue(q: Record<string, Result[]>) {
  return jest.fn((t: string) => chain(q[t].shift() as Result))
}

async function run(admin: Record<string, Result[]>) {
  ;(createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'a' } }, error: null }) },
    from: fromQueue({ users: [{ data: { is_admin: true }, error: null }] })
  })
  ;(createAdminClient as jest.Mock).mockReturnValue({ from: fromQueue(admin) })
  const res = await GET(new NextRequest('http://localhost/x'), { params: Promise.resolve({ paymentId: 'pay' }) })
  return res.json()
}

describe('GET /api/admin/payments/[paymentId]/registrations (#454)', () => {
  it('uses the alternate registration for discount context when there is no user_registration', async () => {
    const data = await run({
      user_registrations: [{ data: [], error: null }],
      alternate_selections: [{ data: [{ id: 'as1', discount_code_id: null, alternate_registrations: { registration_id: 'reg-alt' } }], error: null }],
      xero_invoices: [{ data: [], error: null }],
    })
    expect(data.registrations).toEqual([])
    expect(data.discountContextRegistrationId).toBe('reg-alt')
    expect(data.appliedDiscountCodes).toEqual([])
  })

  it('reports codes already applied on the original invoice', async () => {
    const data = await run({
      user_registrations: [{ data: [{ registration_id: 'reg-1' }], error: null }],
      alternate_selections: [{ data: [], error: null }],
      xero_invoices: [{ data: [{ id: 'inv' }], error: null }],
      xero_invoice_line_items: [{ data: [{ discount_code_id: 'c1' }], error: null }],
      discount_codes: [{ data: [{ id: 'c1', code: '729BOARD50OFF' }], error: null }],
    })
    expect(data.discountContextRegistrationId).toBe('reg-1')
    expect(data.appliedDiscountCodes).toEqual([{ id: 'c1', code: '729BOARD50OFF' }])
  })

  it('reports an alternate selection code that is not on the original invoice', async () => {
    const data = await run({
      user_registrations: [{ data: [], error: null }],
      alternate_selections: [{ data: [{ id: 'as1', discount_code_id: 'c-alt', alternate_registrations: { registration_id: 'reg-alt' } }], error: null }],
      xero_invoices: [{ data: [{ id: 'inv' }], error: null }],
      xero_invoice_line_items: [{ data: [], error: null }],
      discount_codes: [{ data: [{ id: 'c-alt', code: 'ALT25' }], error: null }],
    })
    expect(data.discountContextRegistrationId).toBe('reg-alt')
    expect(data.appliedDiscountCodes).toEqual([{ id: 'c-alt', code: 'ALT25' }])
  })

  it('reports codes used in an earlier refund (credit note) as well as the invoice', async () => {
    const data = await run({
      user_registrations: [{ data: [{ registration_id: 'reg-1' }], error: null }],
      alternate_selections: [{ data: [], error: null }],
      xero_invoices: [{ data: [{ id: 'inv' }, { id: 'cn-1' }], error: null }],
      xero_invoice_line_items: [{ data: [{ discount_code_id: 'c1' }, { discount_code_id: 'c2' }], error: null }],
      discount_codes: [{ data: [{ id: 'c1', code: 'CHECKOUT10' }, { id: 'c2', code: 'REFUND20' }], error: null }],
    })
    expect(data.appliedDiscountCodes.map((c: { code: string }) => c.code)).toEqual(['CHECKOUT10', 'REFUND20'])
  })
})
