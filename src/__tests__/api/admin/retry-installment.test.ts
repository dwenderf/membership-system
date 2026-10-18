/**
 * POST /api/admin/payment-plans/retry-installment: admin only, and only for an
 * installment that already has a failed charge, so it can't be used to charge ahead of schedule.
 */
import { NextRequest } from 'next/server'

let mockIsAdmin = true
let mockInstallment: Record<string, unknown> | null = null
const mockProcessDue = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: mockIsAdmin } }) }) }) })
  }),
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: mockInstallment, error: null }) }) }) })
  })
}))
jest.mock('@/lib/logging/logger', () => ({ logger: { logAdminAction: jest.fn() } }))
jest.mock('@/lib/services/payment-plan-processor', () => ({
  processDuePayments: (...a: unknown[]) => mockProcessDue(...a)
}))

import { POST } from '@/app/api/admin/payment-plans/retry-installment/route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/payment-plans/retry-installment', {
    method: 'POST',
    body: JSON.stringify(body)
  }))

const failed = { id: 'i1', payment_type: 'installment', sync_status: 'planned', attempt_count: 3, failure_reason: 'declined' }

describe('retry-installment', () => {
  beforeEach(() => {
    mockIsAdmin = true
    mockInstallment = failed
    mockProcessDue.mockReset()
  })

  it('rejects non-admins', async () => {
    mockIsAdmin = false
    expect((await call({ installmentId: 'i1' })).status).toBe(403)
    expect(mockProcessDue).not.toHaveBeenCalled()
  })

  it('refuses an installment that has not failed', async () => {
    mockInstallment = { ...failed, attempt_count: 0, failure_reason: null }
    expect((await call({ installmentId: 'i1' })).status).toBe(400)
    expect(mockProcessDue).not.toHaveBeenCalled()
  })

  it('retries a failed installment even when automatic attempts are exhausted', async () => {
    mockProcessDue.mockResolvedValue({ paymentsProcessed: 1, errors: [] })
    const res = await call({ installmentId: 'i1' })
    expect((await res.json()).success).toBe(true)
    expect(mockProcessDue).toHaveBeenCalledWith(expect.any(String), { includeExhausted: true, onlyPaymentIds: ['i1'] })
  })

  it('reports the decline reason when the charge fails again', async () => {
    mockProcessDue.mockResolvedValue({ paymentsProcessed: 0, errors: ['Payment i1: Your card was declined.'] })
    const body = await (await call({ installmentId: 'i1' })).json()
    expect(body).toMatchObject({ success: false, error: 'Your card was declined.' })
  })
})
