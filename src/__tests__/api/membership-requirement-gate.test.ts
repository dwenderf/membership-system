/**
 * Regression tests for the membership requirement gate.
 *
 * Three separate code paths can create a `user_registrations` row, and an
 * investigation found that two of them (the $0/free registration path, and
 * admin waitlist selection) never enforced the registration/category
 * membership requirement at all, while a third (joining a waitlist) fed
 * ineligible users into that gap. These tests exercise the actual route
 * handlers (not just the underlying service) to confirm each entry point
 * now rejects a user who lacks a qualifying membership - one that is paid
 * and valid through at least the end of the registration's season - and
 * does not block a user who has one.
 *
 * Each test only mocks enough to reach and observe the membership check;
 * once a test proves the gate let a qualifying user through, it stops at
 * the next distinguishable step (a DB error, a capacity check, a payment
 * failure) rather than fully mocking Stripe/Xero/email side effects that
 * are unrelated to this bug.
 */

import { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserSavedPaymentMethodId } from '@/lib/services/payment-method-service'
import { WaitlistPaymentService } from '@/lib/services/waitlist-payment-service'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createAdminClient: jest.fn()
}))

jest.mock('@/lib/sentry-helpers', () => ({
  setPaymentContext: jest.fn(),
  capturePaymentError: jest.fn(),
  capturePaymentSuccess: jest.fn()
}))

jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logPaymentProcessing: jest.fn(),
    logSystem: jest.fn()
  }
}))

// Both route modules transitively import '@/lib/email' (directly, or via
// payment-completion-processor), whose EmailProcessor eagerly initializes a
// Logger singleton that isn't set up in this test environment. None of these
// tests exercise the success path that actually sends an email, so mock the
// whole module out rather than initialize it.
jest.mock('@/lib/email', () => ({
  emailService: { sendWaitlistAddedNotification: jest.fn().mockResolvedValue(undefined) }
}))
jest.mock('@/lib/payment-completion-processor', () => ({
  paymentProcessor: {}
}))

jest.mock('@/lib/services/payment-method-service', () => ({
  getUserSavedPaymentMethodId: jest.fn()
}))

jest.mock('@/lib/services/waitlist-payment-service', () => ({
  WaitlistPaymentService: {
    chargeWaitlistUser: jest.fn()
  }
}))

jest.mock('@/lib/email/captain-notifications', () => ({
  stageCaptainRosterChangeNotification: jest.fn().mockResolvedValue(undefined)
}))
jest.mock('@/lib/email/admin-notifications', () => ({
  stageAdminNewRegistrationNotification: jest.fn().mockResolvedValue(undefined)
}))
jest.mock('@/lib/email/waitlist-notifications', () => ({
  stageWaitlistSelectedEmail: jest.fn().mockResolvedValue(undefined)
}))

const REQUIRED_MEMBERSHIP_ID = 'nycpha-full-membership-id'
const SEASON_END_DATE = '2027-02-28'

function noQualifyingMembership() {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            overrideTypes: jest.fn().mockResolvedValue({ data: [], error: null })
          })
        })
      })
    })
  }
}

function membershipNamesLookup() {
  return {
    select: jest.fn().mockReturnValue({
      in: jest.fn().mockResolvedValue({
        data: [{ id: REQUIRED_MEMBERSHIP_ID, name: 'NYCPHA Full Membership' }],
        error: null
      })
    })
  }
}

function qualifyingMembership() {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            overrideTypes: jest.fn().mockResolvedValue({
              data: [{
                id: 'um-1',
                membership_id: REQUIRED_MEMBERSHIP_ID,
                valid_from: '2026-01-01',
                valid_until: '2027-12-31', // Covers through SEASON_END_DATE
                payment_status: 'paid',
                memberships: { id: REQUIRED_MEMBERSHIP_ID, name: 'NYCPHA Full Membership' }
              }],
              error: null
            })
          })
        })
      })
    })
  }
}

describe('membership requirement gate - route enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('POST /api/create-registration-payment-intent - free ($0) registration path', () => {
    function buildRegistrationLookup() {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'reg-1',
                name: 'NYCPHA Recreational League',
                required_membership_id: REQUIRED_MEMBERSHIP_ID,
                season: { end_date: SEASON_END_DATE },
                registration_categories: [
                  {
                    id: 'cat-goalie',
                    price: 0,
                    required_membership_id: null,
                    category: { name: 'Goalie', is_goalie_only: false }
                  }
                ]
              },
              error: null
            })
          })
        })
      }
    }

    async function callFreeRegistration(supabaseFrom: jest.Mock) {
      ;(createClient as jest.Mock).mockResolvedValue({
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com' } }, error: null }) },
        from: supabaseFrom
      })
      // Each test configures createAdminClient itself (the reject test never
      // reaches it; the allow test needs to observe the insert call).

      const request = new NextRequest('http://localhost/api/create-registration-payment-intent', {
        method: 'POST',
        body: JSON.stringify({ registrationId: 'reg-1', categoryId: 'cat-goalie', amount: 0 })
      })

      const { POST } = await import('@/app/api/create-registration-payment-intent/route')
      return POST(request)
    }

    it('rejects a free registration when the user has no qualifying membership', async () => {
      const supabaseFrom = jest.fn()
        .mockReturnValueOnce(buildRegistrationLookup()) // registrations select
        .mockReturnValueOnce(noQualifyingMembership()) // user_memberships (validateMembershipRequirementAsync)
        .mockReturnValueOnce(membershipNamesLookup()) // memberships names for error message
      ;(createAdminClient as jest.Mock).mockReturnValue({ from: jest.fn() })

      const response = await callFreeRegistration(supabaseFrom)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toContain('NYCPHA Full Membership')
    })

    it('does not block a free registration when the user has a season-covering membership', async () => {
      const insert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: { code: 'OTHER', message: 'boom' } })
        })
      })

      const supabaseFrom = jest.fn()
        .mockReturnValueOnce(buildRegistrationLookup()) // registrations select
        .mockReturnValueOnce(qualifyingMembership()) // user_memberships (validateMembershipRequirementAsync)
        .mockReturnValueOnce({ // activeMembership bookkeeping lookup
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                gte: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    single: jest.fn().mockResolvedValue({ data: { id: 'um-1' }, error: null })
                  })
                })
              })
            })
          })
        })

      const adminFrom = jest.fn().mockReturnValue({ insert })
      ;(createAdminClient as jest.Mock).mockReturnValue({ from: adminFrom })

      const response = await callFreeRegistration(supabaseFrom)
      const body = await response.json()

      // Distinguishable from the membership-rejection response: the gate let the
      // user through to the actual insert attempt, which we made fail generically.
      expect(response.status).toBe(500)
      expect(body.error).toBe('Failed to reserve spot')
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-1',
        registration_id: 'reg-1',
        registration_category_id: 'cat-goalie'
      }))
    })
  })

  describe('POST /api/join-waitlist', () => {
    function buildCategoryLookup() {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'cat-skater',
                max_capacity: 88,
                custom_name: null,
                category_id: 'master-cat-1',
                accounting_code: 'ACC1',
                required_membership_id: null,
                sort_order: 1,
                registration_id: 'reg-1',
                categories: { is_goalie_only: false }
              },
              error: null
            })
          })
        })
      }
    }

    function buildRegistrationRequirementsLookup() {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                required_membership_id: REQUIRED_MEMBERSHIP_ID,
                seasons: { end_date: SEASON_END_DATE }
              },
              error: null
            })
          })
        })
      }
    }

    async function callJoinWaitlist(supabaseFrom: jest.Mock) {
      ;(createClient as jest.Mock).mockResolvedValue({
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com' } }, error: null }) },
        from: supabaseFrom
      })
      ;(createAdminClient as jest.Mock).mockReturnValue({ from: jest.fn() })
      ;(getUserSavedPaymentMethodId as jest.Mock).mockResolvedValue('pm_123')

      const request = new NextRequest('http://localhost/api/join-waitlist', {
        method: 'POST',
        body: JSON.stringify({ registrationId: 'reg-1', categoryId: 'cat-skater' })
      })

      const { POST } = await import('@/app/api/join-waitlist/route')
      return POST(request)
    }

    it('rejects joining the waitlist when the user has no qualifying membership', async () => {
      const supabaseFrom = jest.fn()
        .mockReturnValueOnce(buildCategoryLookup()) // registration_categories select
        .mockReturnValueOnce(buildRegistrationRequirementsLookup()) // registrations select
        .mockReturnValueOnce(noQualifyingMembership()) // user_memberships
        .mockReturnValueOnce(membershipNamesLookup()) // memberships names

      const response = await callJoinWaitlist(supabaseFrom)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toContain('NYCPHA Full Membership')
    })

    it('does not block joining the waitlist when the user has a season-covering membership', async () => {
      const supabaseFrom = jest.fn()
        .mockReturnValueOnce(buildCategoryLookup()) // registration_categories select
        .mockReturnValueOnce(buildRegistrationRequirementsLookup()) // registrations select
        .mockReturnValueOnce(qualifyingMembership()) // user_memberships
        .mockReturnValueOnce({ // capacity count query - fails generically to stop the test here
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ count: null, error: { message: 'boom' } })
            })
          })
        })

      const response = await callJoinWaitlist(supabaseFrom)
      const body = await response.json()

      // Distinguishable from the membership-rejection response: the gate let the
      // user through to the (unrelated) capacity check, which we made fail generically.
      expect(response.status).toBe(500)
      expect(body.error).toBe('Failed to check category capacity')
    })
  })

  describe('POST /api/waitlists/[waitlistId]/select (admin promotes a waitlisted user)', () => {
    function buildWaitlistEntryLookup(overrides: { required_membership_id?: string | null; categoryRequiredMembershipId?: string | null } = {}) {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'waitlist-1',
                user_id: 'waitlisted-user-1',
                registration_id: 'reg-1',
                registration_category_id: 'cat-skater',
                discount_code_id: null,
                removed_at: null,
                users: { id: 'waitlisted-user-1', first_name: 'Jamie', last_name: 'Doe', email: 'jamie@example.com' },
                registrations: {
                  id: 'reg-1',
                  name: 'NYCPHA Recreational League',
                  season_id: 'season-1',
                  required_membership_id: overrides.required_membership_id ?? REQUIRED_MEMBERSHIP_ID,
                  seasons: { name: 'Fall/Winter 2026', start_date: '2026-08-31', end_date: SEASON_END_DATE }
                },
                registration_categories: {
                  id: 'cat-skater',
                  custom_name: null,
                  price: 65000,
                  accounting_code: 'ACC1',
                  required_membership_id: overrides.categoryRequiredMembershipId ?? null,
                  categories: { name: 'Skater' }
                }
              },
              error: null
            })
          })
        })
      }
    }

    function buildUsersIsAdminLookup() {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { is_admin: true }, error: null })
          })
        })
      }
    }

    function buildCanUserRegisterLookup() {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
              })
            })
          })
        })
      }
    }

    async function callWaitlistSelect(supabaseFrom: jest.Mock, adminFrom: jest.Mock) {
      ;(createClient as jest.Mock).mockResolvedValue({
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null }) },
        from: supabaseFrom
      })
      ;(createAdminClient as jest.Mock).mockReturnValue({ from: adminFrom })

      const request = new NextRequest('http://localhost/api/waitlists/waitlist-1/select', {
        method: 'POST',
        body: JSON.stringify({})
      })

      const { POST } = await import('@/app/api/waitlists/[waitlistId]/select/route')
      return POST(request, { params: Promise.resolve({ waitlistId: 'waitlist-1' }) })
    }

    it('rejects selecting a waitlisted user who has no qualifying membership', async () => {
      const supabaseFrom = jest.fn()
        .mockReturnValueOnce(buildUsersIsAdminLookup()) // admin check
        .mockReturnValueOnce(buildWaitlistEntryLookup()) // waitlist entry
        .mockReturnValueOnce(buildCanUserRegisterLookup()) // duplicate-registration check

      // The membership check for the WAITLISTED user runs against adminSupabase, not
      // the admin's own RLS-scoped client - see comment in the route.
      const adminFrom = jest.fn()
        .mockReturnValueOnce(noQualifyingMembership()) // user_memberships
        .mockReturnValueOnce(membershipNamesLookup()) // memberships names

      const response = await callWaitlistSelect(supabaseFrom, adminFrom)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toContain('NYCPHA Full Membership')
      expect(WaitlistPaymentService.chargeWaitlistUser).not.toHaveBeenCalled()
    })

    it('does not block selecting a waitlisted user who has a season-covering membership', async () => {
      const supabaseFrom = jest.fn()
        .mockReturnValueOnce(buildUsersIsAdminLookup())
        .mockReturnValueOnce(buildWaitlistEntryLookup())
        .mockReturnValueOnce(buildCanUserRegisterLookup())

      const adminFrom = jest.fn()
        .mockReturnValueOnce(qualifyingMembership()) // user_memberships

      // Distinguishable stopping point unrelated to the membership gate: make the
      // (mocked) charge itself fail, proving the gate had already let this through.
      ;(WaitlistPaymentService.chargeWaitlistUser as jest.Mock).mockResolvedValue({ success: false })

      const response = await callWaitlistSelect(supabaseFrom, adminFrom)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBe('Payment failed')
      expect(WaitlistPaymentService.chargeWaitlistUser).toHaveBeenCalledWith(
        'waitlisted-user-1',
        'reg-1',
        'cat-skater',
        'Skater',
        undefined,
        undefined
      )
    })
  })
})
