/**
 * POST /api/join-waitlist stores the member's payment-plan choice (#442), and only accepts it
 * from a member who is payment-plan eligible.
 */

import { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserSavedPaymentMethodId } from '@/lib/services/payment-method-service'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn()
}))
jest.mock('@/lib/logging/logger', () => ({
  logger: { logPaymentProcessing: jest.fn(), logSystem: jest.fn() }
}))
jest.mock('@/lib/email', () => ({
  emailService: { sendWaitlistAddedNotification: jest.fn().mockResolvedValue(undefined) }
}))
jest.mock('@/lib/services/payment-method-service', () => ({
  getUserSavedPaymentMethodId: jest.fn()
}))
jest.mock('@/lib/policy-acceptance', () => ({
  logPolicyAcceptance: jest.fn().mockResolvedValue(undefined)
}))
jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn()
}))
jest.mock('@/lib/sentry-flush', () => ({ scheduleSentryFlush: jest.fn() }))

type Result = { data?: unknown; error?: unknown; count?: number | null }

/**
 * A chainable query stand-in: every builder method returns the chain, and awaiting it (or
 * calling single/maybeSingle) yields resolve(ops), where ops lists the methods called.
 */
function chain(resolve: (ops: string[]) => Result, onInsert?: (row: unknown) => void) {
  const ops: string[] = []
  const done = () => Promise.resolve({ data: null, error: null, ...resolve(ops) })
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (ok: (v: unknown) => void, err: (e: unknown) => void) => done().then(ok, err)
      if (prop === 'single' || prop === 'maybeSingle') return () => done()
      return (...args: unknown[]) => {
        ops.push(prop)
        if ((prop === 'insert' || prop === 'update') && onInsert) onInsert(args[0])
        return proxy
      }
    }
  })
  return proxy
}

let writtenWaitlistRow: Record<string, unknown> | undefined

function setup(planUser: { payment_plan_enabled: boolean; stripe_payment_method_id: string | null }) {
  writtenWaitlistRow = undefined
  const from = jest.fn((table: string) => {
    switch (table) {
      case 'registration_categories':
        return chain(() => ({
          data: { id: 'cat-1', max_capacity: 10, custom_name: 'Skater', category_id: null, required_membership_id: null, categories: { is_goalie_only: false } }
        }))
      case 'registrations':
        return chain(() => ({
          data: { required_membership_id: null, name: 'Fall League', seasons: { name: 'Fall', start_date: '2026-09-01', end_date: '2026-12-31' } }
        }))
      case 'user_registrations':
        return chain(() => ({ count: 10, data: null }))
      case 'waitlists':
        return chain(
          (ops) => (ops.includes('insert') ? { data: { id: 'wl-1', ...writtenWaitlistRow } } : { data: null }),
          (row) => { writtenWaitlistRow = row as Record<string, unknown> }
        )
      case 'users':
        return chain(() => ({ data: { first_name: 'Max', last_name: 'Member', email: 'm@example.com' } }))
      default:
        return chain(() => ({ data: null }))
    }
  })

  ;(createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
    from
  })
  ;(createAdminClient as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) => chain(() => (table === 'users' ? { data: planUser } : { data: null })))
  })
  ;(getUserSavedPaymentMethodId as jest.Mock).mockResolvedValue('pm_1')
}

async function join(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/join-waitlist/route')
  const response = await POST(new NextRequest('http://localhost/api/join-waitlist', {
    method: 'POST',
    body: JSON.stringify({ registrationId: 'reg-1', categoryId: 'cat-1', policiesAccepted: true, ...body })
  }))
  return { status: response.status, body: await response.json() }
}

describe('POST /api/join-waitlist - payment plan choice (#442)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('stores use_payment_plan for an eligible member who opts in', async () => {
    setup({ payment_plan_enabled: true, stripe_payment_method_id: 'pm_1' })

    const { status, body } = await join({ usePaymentPlan: true })

    expect(status).toBe(200)
    expect(body.usePaymentPlan).toBe(true)
    expect(writtenWaitlistRow).toMatchObject({ user_id: 'user-1', use_payment_plan: true })
  })

  it('rejects an opt-in from a member who is not payment-plan eligible', async () => {
    setup({ payment_plan_enabled: false, stripe_payment_method_id: 'pm_1' })

    const { status, body } = await join({ usePaymentPlan: true })

    expect(status).toBe(400)
    expect(body.error).toMatch(/not eligible for payment plans/)
    expect(writtenWaitlistRow).toBeUndefined()
  })

  it('defaults to no payment plan when the member does not opt in', async () => {
    setup({ payment_plan_enabled: true, stripe_payment_method_id: 'pm_1' })

    const { status } = await join({})

    expect(status).toBe(200)
    expect(writtenWaitlistRow).toMatchObject({ use_payment_plan: false })
  })
})
