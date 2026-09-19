// Regression coverage for issue #295: account deletion must delete the
// Supabase auth user BEFORE anonymizing public.users, so a failure partway
// through can never leave an account that looks deleted but can still sign in.

import { POST } from '@/app/api/delete-account/route'

jest.mock('@/lib/supabase/server')
jest.mock('@/lib/email')
jest.mock('@/lib/stripe/server-client')
jest.mock('@/lib/sentry-helpers')
jest.mock('@/lib/logging/logger')

const mockLogger = { logSystem: jest.fn() }
jest.requireMock('@/lib/logging/logger').logger = mockLogger

const mockEmailService = {
  sendAccountDeletionConfirmation: jest.fn().mockResolvedValue(undefined),
  deleteLoopsContact: jest.fn().mockResolvedValue(undefined),
}
jest.requireMock('@/lib/email').emailService = mockEmailService

const mockSentry = jest.requireMock('@/lib/sentry-helpers')
mockSentry.captureCriticalAccountDeletionError = jest.fn()
mockSentry.captureAccountDeletionWarning = jest.fn()

const mockStripe = {
  paymentMethods: {
    list: jest.fn().mockResolvedValue({ data: [] }),
    detach: jest.fn().mockResolvedValue({}),
  },
  customers: {
    del: jest.fn().mockResolvedValue({}),
  },
}
jest.requireMock('@/lib/stripe/server-client').getStripe = jest.fn(() => mockStripe)

interface UserProfile {
  email: string
  first_name: string
  last_name: string
  deleted_at: string | null
  stripe_customer_id: string | null
}

interface PaymentPlan {
  id: string
  total_amount: number
  paid_amount: number
}

let authUser: { id: string; email: string } | null
let userProfile: UserProfile | null
let profileError: { message: string } | null
let paymentPlans: PaymentPlan[]
let paymentPlansError: { message: string } | null
let deleteUserError: { message: string } | null
let usersUpdateError: { message: string } | null
let surveyDeleteError: { message: string } | null

let usersUpdatePayload: Record<string, unknown> | undefined
const callOrder: string[] = []

const signOut = jest.fn().mockResolvedValue({ error: null })

const mockSupabase = {
  auth: {
    getUser: jest.fn(() => Promise.resolve({ data: { user: authUser }, error: null })),
    signOut: (...args: unknown[]) => {
      callOrder.push('signout')
      return signOut(...args)
    },
  },
  from: jest.fn((table: string) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: userProfile, error: profileError }),
          }),
        }),
      }
    }
    if (table === 'payment_plans') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: paymentPlans, error: paymentPlansError }),
          }),
        }),
      }
    }
    throw new Error(`unexpected table on user client: ${table}`)
  }),
}

const mockAdminClient = {
  auth: {
    admin: {
      deleteUser: jest.fn(() => {
        callOrder.push('auth_delete')
        return Promise.resolve({ error: deleteUserError })
      }),
    },
  },
  from: jest.fn((table: string) => {
    if (table === 'user_survey_responses') {
      return {
        delete: () => ({
          eq: () => {
            callOrder.push('survey_delete')
            return Promise.resolve({ error: surveyDeleteError })
          },
        }),
      }
    }
    if (table === 'users') {
      return {
        update: (payload: Record<string, unknown>) => ({
          eq: () => {
            callOrder.push('anonymize_update')
            usersUpdatePayload = payload
            return Promise.resolve({ error: usersUpdateError })
          },
        }),
      }
    }
    throw new Error(`unexpected table on admin client: ${table}`)
  }),
}

jest.requireMock('@/lib/supabase/server').createClient = jest.fn(() => Promise.resolve(mockSupabase))
jest.requireMock('@/lib/supabase/server').createAdminClient = jest.fn(() => mockAdminClient)

describe('/api/delete-account', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    callOrder.length = 0
    usersUpdatePayload = undefined

    authUser = { id: 'user-1', email: 'real@example.com' }
    userProfile = {
      email: 'real@example.com',
      first_name: 'Real',
      last_name: 'Person',
      deleted_at: null,
      stripe_customer_id: null,
    }
    profileError = null
    paymentPlans = []
    paymentPlansError = null
    deleteUserError = null
    usersUpdateError = null
    surveyDeleteError = null

    mockStripe.paymentMethods.list.mockResolvedValue({ data: [] })
    mockStripe.paymentMethods.detach.mockImplementation((id: string) => {
      callOrder.push(`stripe_detach:${id}`)
      return Promise.resolve({})
    })
    mockStripe.customers.del.mockImplementation((id: string) => {
      callOrder.push(`stripe_del:${id}`)
      return Promise.resolve({})
    })
    mockEmailService.deleteLoopsContact.mockImplementation(() => {
      callOrder.push('loops_delete')
      return Promise.resolve(undefined)
    })
  })

  it('rejects an unauthenticated request', async () => {
    authUser = null

    const response = await POST()

    expect(response.status).toBe(401)
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects a retry on an already-deleted account without touching auth or business data', async () => {
    userProfile!.deleted_at = '2024-01-01T00:00:00.000Z'

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Account already deleted')
    expect(mockAdminClient.auth.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('blocks deletion when a payment plan has an outstanding balance', async () => {
    paymentPlans = [{ id: 'pp-1', total_amount: 10000, paid_amount: 4000 }]

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.hasActivePaymentPlans).toBe(true)
    expect(body.outstandingBalance).toBe(6000)
    expect(mockEmailService.sendAccountDeletionConfirmation).not.toHaveBeenCalled()
    expect(mockAdminClient.auth.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('deletes the auth user before anonymizing public.users, and resets every PII field', async () => {
    userProfile!.stripe_customer_id = 'cus_123'
    mockStripe.paymentMethods.list.mockResolvedValue({ data: [{ id: 'pm_1' }, { id: 'pm_2' }] })

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)

    // Stripe: every saved card detached, then the customer deleted.
    expect(mockStripe.paymentMethods.detach).toHaveBeenCalledWith('pm_1')
    expect(mockStripe.paymentMethods.detach).toHaveBeenCalledWith('pm_2')
    expect(mockStripe.customers.del).toHaveBeenCalledWith('cus_123')

    // Loops contact removed.
    expect(mockEmailService.deleteLoopsContact).toHaveBeenCalledWith('real@example.com')

    // The critical ordering fix: auth.users is deleted before public.users is touched.
    const authDeleteIndex = callOrder.indexOf('auth_delete')
    const anonymizeIndex = callOrder.indexOf('anonymize_update')
    expect(authDeleteIndex).toBeGreaterThanOrEqual(0)
    expect(anonymizeIndex).toBeGreaterThan(authDeleteIndex)

    // Full field reset, not just name/email/phone.
    expect(usersUpdatePayload).toMatchObject({
      first_name: 'Deleted',
      last_name: 'User',
      email: 'deleted_user_user-1@deleted.local',
      phone: null,
      is_lgbtq: null,
      is_goalie: false,
      tags: [],
      preferences: null,
      stripe_customer_id: null,
      stripe_setup_intent_id: null,
      stripe_payment_method_id: null,
      setup_intent_status: null,
    })
  })

  it('never anonymizes public.users when the auth-user deletion fails', async () => {
    deleteUserError = { message: 'GoTrue is down' }

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Failed to complete account deletion')
    expect(callOrder).not.toContain('anonymize_update')
    expect(mockSentry.captureCriticalAccountDeletionError).toHaveBeenCalled()
  })

  it('reports a critical error (but does not fail login-blocking) when anonymization fails after a successful auth delete', async () => {
    usersUpdateError = { message: 'connection reset' }

    const response = await POST()

    expect(response.status).toBe(500)
    expect(mockAdminClient.auth.admin.deleteUser).toHaveBeenCalled()
    expect(mockSentry.captureCriticalAccountDeletionError).toHaveBeenCalled()
  })

  it('aborts before deleting the auth user if Stripe cleanup fails for a real error', async () => {
    userProfile!.stripe_customer_id = 'cus_123'
    mockStripe.customers.del.mockRejectedValue(new Error('stripe outage'))

    const response = await POST()

    expect(response.status).toBe(500)
    expect(mockAdminClient.auth.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('treats an already-deleted Stripe customer as success (safe to retry)', async () => {
    userProfile!.stripe_customer_id = 'cus_123'
    mockStripe.customers.del.mockRejectedValue({ code: 'resource_missing' })

    const response = await POST()

    expect(response.status).toBe(200)
    expect(mockAdminClient.auth.admin.deleteUser).toHaveBeenCalled()
  })

  it('aborts before deleting the auth user if Loops cleanup fails', async () => {
    mockEmailService.deleteLoopsContact.mockRejectedValue(new Error('loops outage'))

    const response = await POST()

    expect(response.status).toBe(500)
    expect(mockAdminClient.auth.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('aborts before deleting the auth user if survey response cleanup fails', async () => {
    surveyDeleteError = { message: 'db error' }

    const response = await POST()

    expect(response.status).toBe(500)
    expect(mockAdminClient.auth.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('still completes deletion when the confirmation email fails to send', async () => {
    mockEmailService.sendAccountDeletionConfirmation.mockRejectedValue(new Error('loops down'))

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockAdminClient.auth.admin.deleteUser).toHaveBeenCalled()
  })
})
