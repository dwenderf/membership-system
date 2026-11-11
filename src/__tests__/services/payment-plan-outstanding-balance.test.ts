/**
 * An installment left in 'processing' (charge sent, outcome not confirmed) is still owed, so the
 * balance guards behind account deletion and card removal must count it. The guards read through
 * the admin client, because a member's own session can't see xero_payments.
 */

type Row = Record<string, unknown>

let tables: Record<string, Row[]> = {}

function query(table: string) {
  let rows = [...(tables[table] ?? [])]
  const q = {
    select: () => q,
    eq: (col: string, val: unknown) => {
      const [field, key] = col.split('->>')
      rows = rows.filter(r => (key ? (r[field] as Row | undefined)?.[key] : r[col]) === val)
      return q
    },
    or: () => q,
    in: (col: string, vals: unknown[]) => { rows = rows.filter(r => vals.includes(r[col])); return q },
    limit: (n: number) => { rows = rows.slice(0, n); return q },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null })
  }
  return q
}

const fakeClient = { from: (table: string) => query(table) }

// A member's own session can't read xero_payments (admin-only RLS), so it sees no rows at all.
const memberSessionClient = { from: () => query('__no_access__') }

jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => memberSessionClient,
  createAdminClient: () => fakeClient
}))
jest.mock('@/lib/stripe/server-client', () => ({ getStripe: () => ({}) }))
jest.mock('@/lib/logging/logger', () => ({
  logger: { logPaymentProcessing: jest.fn(), logBatchProcessing: jest.fn(), logXeroSync: jest.fn() }
}))

import { PaymentPlanService, OUTSTANDING_PLAN_PAYMENT_STATUSES } from '@/lib/services/payment-plan-service'

const USER = 'user-1'

function plan(installments: Array<{ sync_status: string; amount_paid: number }>) {
  tables = {
    xero_invoices: [{ id: 'inv-1', is_payment_plan: true, invoice_status: 'AUTHORISED', staging_metadata: { user_id: USER } }],
    xero_payments: installments.map((i, n) => ({ id: `xp-${n + 1}`, xero_invoice_id: 'inv-1', ...i }))
  }
}

describe('payment plan balance guards', () => {
  it('counts processing as outstanding', () => {
    expect(OUTSTANDING_PLAN_PAYMENT_STATUSES).toEqual(expect.arrayContaining(['planned', 'staged', 'processing']))
  })

  it('keeps the balance open when the last installment is stuck in processing', async () => {
    plan([
      { sync_status: 'synced', amount_paid: 2500 },
      { sync_status: 'synced', amount_paid: 2500 },
      { sync_status: 'synced', amount_paid: 2500 },
      { sync_status: 'processing', amount_paid: 2500 }
    ])

    await expect(PaymentPlanService.hasOutstandingBalance(USER)).resolves.toBe(true)
    await expect(PaymentPlanService.getTotalOutstandingBalance(USER)).resolves.toBe(2500)
  })

  it('reports no balance once every installment is paid', async () => {
    plan([
      { sync_status: 'synced', amount_paid: 2500 },
      { sync_status: 'synced', amount_paid: 2500 },
      { sync_status: 'pending', amount_paid: 2500 },
      { sync_status: 'synced', amount_paid: 2500 }
    ])

    await expect(PaymentPlanService.hasOutstandingBalance(USER)).resolves.toBe(false)
    await expect(PaymentPlanService.getTotalOutstandingBalance(USER)).resolves.toBe(0)
  })

  it('still counts planned and staged rows, and skips cancelled ones', async () => {
    plan([
      { sync_status: 'synced', amount_paid: 2500 },
      { sync_status: 'staged', amount_paid: 2500 },
      { sync_status: 'planned', amount_paid: 2500 },
      { sync_status: 'cancelled', amount_paid: 2500 }
    ])

    await expect(PaymentPlanService.getTotalOutstandingBalance(USER)).resolves.toBe(5000)
  })

  it("ignores another member's plan", async () => {
    tables = {
      xero_invoices: [{ id: 'inv-2', is_payment_plan: true, invoice_status: 'AUTHORISED', staging_metadata: { user_id: 'someone-else' } }],
      xero_payments: [{ id: 'xp-1', xero_invoice_id: 'inv-2', sync_status: 'planned', amount_paid: 2500 }]
    }

    await expect(PaymentPlanService.hasOutstandingBalance(USER)).resolves.toBe(false)
    await expect(PaymentPlanService.getTotalOutstandingBalance(USER)).resolves.toBe(0)
  })
})
