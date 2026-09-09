/**
 * Tests for Registration Validation Service
 *
 * Tests critical business logic for registration eligibility:
 * - Preventing duplicate registrations
 * - Allowing re-registration after refund
 * - Payment method validation
 */

import { RegistrationValidationService } from '@/lib/services/registration-validation-service'
import { SupabaseClient } from '@supabase/supabase-js'

type MockSupabaseClient = {
  from: jest.Mock
}

function asClient(client: MockSupabaseClient): SupabaseClient {
  return client as unknown as SupabaseClient
}

describe('RegistrationValidationService', () => {
  let mockSupabase: MockSupabaseClient

  beforeEach(() => {
    jest.clearAllMocks()

    // Create a mock Supabase client
    mockSupabase = {
      from: jest.fn()
    }
  })

  describe('canUserRegister', () => {
    it('should allow registration when no existing registration exists', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' } // No rows returned
                })
              })
            })
          })
        })
      })

      const result = await RegistrationValidationService.canUserRegister(
        asClient(mockSupabase),
        'user-123',
        'registration-456'
      )

      expect(result.canRegister).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.existingRegistration).toBeUndefined()

      // Verify query was made with correct filters
      expect(mockSupabase.from).toHaveBeenCalledWith('user_registrations')
    })

    it('should prevent registration when user has existing PAID registration', async () => {
      const existingReg = {
        id: 'reg-789',
        payment_status: 'paid'
      }

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: existingReg,
                  error: null
                })
              })
            })
          })
        })
      })

      const result = await RegistrationValidationService.canUserRegister(
        asClient(mockSupabase),
        'user-123',
        'registration-456'
      )

      expect(result.canRegister).toBe(false)
      expect(result.error).toBe('User is already registered for this event')
      expect(result.existingRegistration).toEqual(existingReg)
    })

    it('should ALLOW registration when user has REFUNDED registration (critical case)', async () => {
      // This is the bug that was fixed - refunded registrations should not block re-registration
      // The query filters for payment_status = 'paid', so refunded registrations won't be returned
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' } // No paid registration found
                })
              })
            })
          })
        })
      })

      const result = await RegistrationValidationService.canUserRegister(
        asClient(mockSupabase),
        'user-123',
        'registration-456'
      )

      // The critical behavior: refunded registrations should NOT block re-registration
      expect(result.canRegister).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should handle database errors gracefully', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST500', message: 'Database connection error' }
                })
              })
            })
          })
        })
      })

      await expect(
        RegistrationValidationService.canUserRegister(
          asClient(mockSupabase),
          'user-123',
          'registration-456'
        )
      ).rejects.toThrow('Failed to check registration status')
    })
  })

  describe('validatePaymentMethod', () => {
    it('should validate a user with valid payment method', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                stripe_payment_method_id: 'pm_123',
                setup_intent_status: 'succeeded'
              },
              error: null
            })
          })
        })
      })

      const result = await RegistrationValidationService.validatePaymentMethod(
        asClient(mockSupabase),
        'user-123'
      )

      expect(result.isValid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should reject user without payment method', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                stripe_payment_method_id: null,
                setup_intent_status: null
              },
              error: null
            })
          })
        })
      })

      const result = await RegistrationValidationService.validatePaymentMethod(
        asClient(mockSupabase),
        'user-123'
      )

      expect(result.isValid).toBe(false)
      expect(result.error).toBe('User does not have a valid payment method')
    })

    it('should accept user with payment method ID even if setup_intent_status is not succeeded', async () => {
      // setup_intent_status is intentionally not checked — the PM ID alone is sufficient.
      // PMs can be attached via Customer Portal or payment intent with setup_future_usage
      // and will have a null/non-succeeded setup_intent_status.
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                stripe_payment_method_id: 'pm_123',
                setup_intent_status: 'processing' // Not succeeded, but PM ID is present
              },
              error: null
            })
          })
        })
      })

      const result = await RegistrationValidationService.validatePaymentMethod(
        asClient(mockSupabase),
        'user-123'
      )

      expect(result.isValid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should handle user not found error', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'User not found' }
            })
          })
        })
      })

      await expect(
        RegistrationValidationService.validatePaymentMethod(
          asClient(mockSupabase),
          'user-123'
        )
      ).rejects.toThrow('User not found')
    })
  })

  describe('validateRegistrationEligibility', () => {
    it('should allow registration with no payment method for zero-cost registration', async () => {
      // Mock canUserRegister - no existing registration
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' }
                })
              })
            })
          })
        })
      })

      // No payment method validation should happen for effectivePrice = 0

      const result = await RegistrationValidationService.validateRegistrationEligibility(
        asClient(mockSupabase),
        'user-123',
        'registration-456',
        {
          effectivePrice: 0 // Zero-cost registration
        }
      )

      expect(result.canRegister).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.reason).toBeUndefined()

      // Verify payment method validation was NOT called
      expect(mockSupabase.from).toHaveBeenCalledTimes(1) // Only canUserRegister
    })

    it('should require payment method for paid registration', async () => {
      // Mock canUserRegister - no existing registration
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' }
                })
              })
            })
          })
        })
      })

      // Mock validatePaymentMethod - no valid payment method
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                stripe_payment_method_id: null,
                setup_intent_status: null
              },
              error: null
            })
          })
        })
      })

      const result = await RegistrationValidationService.validateRegistrationEligibility(
        asClient(mockSupabase),
        'user-123',
        'registration-456',
        {
          effectivePrice: 3500 // $35.00 registration
        }
      )

      expect(result.canRegister).toBe(false)
      expect(result.error).toBe('User does not have a valid payment method')
      expect(result.reason).toBe('invalid_payment_method')

      // Verify both checks were called
      expect(mockSupabase.from).toHaveBeenCalledTimes(2)
    })

    it('should prevent registration when duplicate exists, regardless of payment method', async () => {
      // Mock canUserRegister - existing paid registration
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'existing-reg',
                    payment_status: 'paid'
                  },
                  error: null
                })
              })
            })
          })
        })
      })

      // Payment method validation should NOT be called because duplicate check fails first

      const result = await RegistrationValidationService.validateRegistrationEligibility(
        asClient(mockSupabase),
        'user-123',
        'registration-456',
        {
          effectivePrice: 3500
        }
      )

      expect(result.canRegister).toBe(false)
      expect(result.error).toBe('User is already registered for this event')
      expect(result.reason).toBe('duplicate_registration')

      // Verify payment method check was NOT called (short-circuit)
      expect(mockSupabase.from).toHaveBeenCalledTimes(1)
    })

    it('should allow registration with valid payment method for paid registration', async () => {
      // Mock canUserRegister - no existing registration
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' }
                })
              })
            })
          })
        })
      })

      // Mock validatePaymentMethod - valid payment method
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                stripe_payment_method_id: 'pm_123',
                setup_intent_status: 'succeeded'
              },
              error: null
            })
          })
        })
      })

      const result = await RegistrationValidationService.validateRegistrationEligibility(
        asClient(mockSupabase),
        'user-123',
        'registration-456',
        {
          effectivePrice: 4500 // $45.00
        }
      )

      expect(result.canRegister).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.reason).toBeUndefined()
    })

    it('should validate payment method when explicitly required, even for zero-cost', async () => {
      // Mock canUserRegister - no existing registration
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' }
                })
              })
            })
          })
        })
      })

      // Mock validatePaymentMethod - no payment method
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                stripe_payment_method_id: null,
                setup_intent_status: null
              },
              error: null
            })
          })
        })
      })

      const result = await RegistrationValidationService.validateRegistrationEligibility(
        asClient(mockSupabase),
        'user-123',
        'registration-456',
        {
          requirePaymentMethod: true, // Explicitly require payment method
          effectivePrice: 0
        }
      )

      expect(result.canRegister).toBe(false)
      expect(result.error).toBe('User does not have a valid payment method')
      expect(result.reason).toBe('invalid_payment_method')
    })
  })

  describe('Integration scenarios', () => {
    it('should handle the refund-then-reregister scenario correctly', async () => {
      // Scenario: User had a zero-cost membership registration that was refunded.
      // They should be able to register again for a different category.

      // Step 1: Check if user can register (refunded registration exists but is filtered out)
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null, // No PAID registration found
                  error: { code: 'PGRST116' }
                })
              })
            })
          })
        })
      })

      // Step 2: For a paid registration, check payment method
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                stripe_payment_method_id: 'pm_456',
                setup_intent_status: 'succeeded'
              },
              error: null
            })
          })
        })
      })

      const result = await RegistrationValidationService.validateRegistrationEligibility(
        asClient(mockSupabase),
        'user-with-refunded-reg',
        'new-registration-789',
        {
          effectivePrice: 3500 // New category costs $35
        }
      )

      expect(result.canRegister).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should skip payment validation when discounts might apply (waitlist flow)', async () => {
      // Scenario: Waitlist selection with potential 100% discount code
      // We can't validate payment method based on base price because discounts might make it free
      // Solution: Only check for duplicate registration, let payment service validate after discount calculation

      // Step 1: Check if user can register (no duplicate)
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' }
                })
              })
            })
          })
        })
      })

      // When we DON'T pass effectivePrice, payment method validation is skipped
      const result = await RegistrationValidationService.validateRegistrationEligibility(
        asClient(mockSupabase),
        'user-123',
        'registration-456',
        {
          // No effectivePrice provided - skip payment validation
          // Payment service will validate AFTER calculating final discounted amount
        }
      )

      expect(result.canRegister).toBe(true)
      expect(result.error).toBeUndefined()

      // Verify ONLY duplicate check was performed (1 query), NOT payment method check
      expect(mockSupabase.from).toHaveBeenCalledTimes(1)
      expect(mockSupabase.from).toHaveBeenCalledWith('user_registrations')
    })
  })

  describe('validateMembershipRequirement', () => {
    const today = new Date().toISOString().split('T')[0]
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    // Most tests below aren't about season coverage specifically, so use a
    // season that ends today - equivalent to the old "is it active right now" check.
    const seasonEndDate = today

    describe('No requirements (membership not required)', () => {
      it('should allow registration when no membership requirements are set', () => {
        const result = RegistrationValidationService.validateMembershipRequirement(
          null, // No registration-level requirement
          null, // No category-level requirement
          [], // User has no memberships
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(true)
        expect(result.matchedMembership).toEqual({
          id: '',
          name: 'No membership required',
          source: 'none'
        })
        expect(result.error).toBeUndefined()
      })
    })

    describe('Registration-level requirements only', () => {
      it('should allow registration when user has registration-level membership', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'standard-adult-id',
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'paid' as const,
            memberships: {
              id: 'standard-adult-id',
              name: 'Standard Adult'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id', // Registration requires Standard Adult
          null, // No category requirement
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(true)
        expect(result.matchedMembership).toEqual({
          id: 'standard-adult-id',
          name: 'Standard Adult',
          source: 'registration'
        })
        expect(result.error).toBeUndefined()
      })

      it('should deny registration when user lacks registration-level membership', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'social-membership-id', // User has Social, not Standard
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'paid' as const,
            memberships: {
              id: 'social-membership-id',
              name: 'Social'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id', // Registration requires Standard Adult
          null,
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(false)
        expect(result.error).toContain('registration-level membership')
        expect(result.matchedMembership).toBeUndefined()
      })
    })

    describe('Category-level requirements only', () => {
      it('should allow registration when user has category-level membership', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'tournament-membership-id',
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'paid' as const,
            memberships: {
              id: 'tournament-membership-id',
              name: 'Tournament Membership'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          null, // No registration requirement
          'tournament-membership-id', // Category requires Tournament
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(true)
        expect(result.matchedMembership).toEqual({
          id: 'tournament-membership-id',
          name: 'Tournament Membership',
          source: 'category'
        })
        expect(result.error).toBeUndefined()
      })
    })

    describe('Two-level requirements (hierarchical)', () => {
      it('should allow registration with registration-level membership (higher tier)', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'standard-adult-id',
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'paid' as const,
            memberships: {
              id: 'standard-adult-id',
              name: 'Standard Adult'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id', // Registration requires Standard Adult
          'tournament-membership-id', // Category accepts Tournament
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(true)
        expect(result.matchedMembership).toEqual({
          id: 'standard-adult-id',
          name: 'Standard Adult',
          source: 'registration'
        })
      })

      it('should allow registration with category-level membership (alternative)', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'tournament-membership-id',
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'paid' as const,
            memberships: {
              id: 'tournament-membership-id',
              name: 'Tournament Membership'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id', // Registration requires Standard Adult
          'tournament-membership-id', // Category accepts Tournament
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(true)
        expect(result.matchedMembership).toEqual({
          id: 'tournament-membership-id',
          name: 'Tournament Membership',
          source: 'category'
        })
      })

      it('should deny registration when user has neither qualifying membership', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'social-membership-id',
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'paid' as const,
            memberships: {
              id: 'social-membership-id',
              name: 'Social'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id', // Registration requires Standard Adult
          'tournament-membership-id', // Category accepts Tournament
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(false)
        expect(result.error).toContain('registration-level membership or category-level membership')
        expect(result.matchedMembership).toBeUndefined()
      })

      it('should prefer registration-level membership when user has both', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'standard-adult-id',
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'paid' as const,
            memberships: {
              id: 'standard-adult-id',
              name: 'Standard Adult'
            }
          },
          {
            id: 'um-2',
            membership_id: 'tournament-membership-id',
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'paid' as const,
            memberships: {
              id: 'tournament-membership-id',
              name: 'Tournament'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id',
          'tournament-membership-id',
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(true)
        expect(result.matchedMembership?.source).toBe('registration')
      })
    })

    describe('Membership validation rules', () => {
      it('should deny registration with expired membership', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'standard-adult-id',
            valid_from: '2024-01-01',
            valid_until: yesterday, // Expired
            payment_status: 'paid' as const,
            memberships: {
              id: 'standard-adult-id',
              name: 'Standard Adult'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id',
          null,
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(false)
        expect(result.error).toContain('registration-level membership')
      })

      it('should deny registration with unpaid membership', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'standard-adult-id',
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'pending' as const, // Not paid
            memberships: {
              id: 'standard-adult-id',
              name: 'Standard Adult'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id',
          null,
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(false)
        expect(result.error).toContain('registration-level membership')
      })

      it('should allow registration with membership valid today', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'standard-adult-id',
            valid_from: yesterday,
            valid_until: today, // Expires today (should still be valid)
            payment_status: 'paid' as const,
            memberships: {
              id: 'standard-adult-id',
              name: 'Standard Adult'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id',
          null,
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(true)
        expect(result.matchedMembership?.id).toBe('standard-adult-id')
      })

      it('should handle user with no memberships at all', () => {
        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id',
          null,
          [], // No memberships
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(false)
        expect(result.error).toContain('registration-level membership')
      })
    })

    describe('Real-world scenarios', () => {
      it('Chelsea Challenge: free tournament membership for non-members', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'chelsea-challenge-2026-id',
            valid_from: '2026-01-01',
            valid_until: '2026-12-31',
            payment_status: 'paid' as const,
            memberships: {
              id: 'chelsea-challenge-2026-id',
              name: 'Chelsea Challenge 2026'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          null, // No registration-level requirement
          'chelsea-challenge-2026-id', // Category requires tournament membership
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(true)
        expect(result.matchedMembership).toEqual({
          id: 'chelsea-challenge-2026-id',
          name: 'Chelsea Challenge 2026',
          source: 'category'
        })
      })

      it('Chelsea Challenge: social category for non-skating guests', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'social-membership-id',
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'paid' as const,
            memberships: {
              id: 'social-membership-id',
              name: 'Social'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          null, // No registration requirement
          'social-membership-id', // Social category requires Social membership
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(true)
        expect(result.matchedMembership?.name).toBe('Social')
      })

      it('Standard registration: member can use standard membership', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'standard-adult-id',
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'paid' as const,
            memberships: {
              id: 'standard-adult-id',
              name: 'Standard Adult'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id', // Registration requires Standard
          'tournament-membership-id', // But tournament membership also accepted
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(true)
        expect(result.matchedMembership?.source).toBe('registration')
      })

      it('Tournament registration: non-member uses free tournament membership', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'tournament-membership-id',
            valid_from: yesterday,
            valid_until: tomorrow,
            payment_status: 'paid' as const,
            memberships: {
              id: 'tournament-membership-id',
              name: 'Tournament Membership'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id', // Registration prefers Standard
          'tournament-membership-id', // But tournament accepted
          userMemberships,
          seasonEndDate
        )

        expect(result.hasRequiredMembership).toBe(true)
        expect(result.matchedMembership?.source).toBe('category')
      })
    })

    describe('Season coverage (membership must last through the season, not just be active today)', () => {
      const seasonEnd = '2027-02-28' // e.g. Fall/Winter 2026 season end

      it('should deny registration when membership is active today but expires before the season ends', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'standard-adult-id',
            valid_from: '2026-08-01',
            valid_until: '2026-12-01', // Active right now, but lapses mid-season
            payment_status: 'paid' as const,
            memberships: {
              id: 'standard-adult-id',
              name: 'Standard Adult'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id',
          null,
          userMemberships,
          seasonEnd
        )

        expect(result.hasRequiredMembership).toBe(false)
        expect(result.error).toContain('registration-level membership')
      })

      it('should allow registration when membership covers through the season end date', () => {
        const userMemberships = [
          {
            id: 'um-1',
            membership_id: 'standard-adult-id',
            valid_from: '2026-08-01',
            valid_until: seasonEnd,
            payment_status: 'paid' as const,
            memberships: {
              id: 'standard-adult-id',
              name: 'Standard Adult'
            }
          }
        ]

        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id',
          null,
          userMemberships,
          seasonEnd
        )

        expect(result.hasRequiredMembership).toBe(true)
      })

      it('should deny registration when the user has no membership at all, regardless of season', () => {
        const result = RegistrationValidationService.validateMembershipRequirement(
          'standard-adult-id',
          null,
          [],
          seasonEnd
        )

        expect(result.hasRequiredMembership).toBe(false)
      })
    })
  })

  describe('validateMembershipRequirementAsync', () => {
    const seasonEndDate = '2027-02-28'

    function membershipsQueryResult(result: { data: unknown; error: unknown }) {
      const gte = jest.fn().mockReturnValue({
        overrideTypes: jest.fn().mockResolvedValue(result)
      })
      const eq2 = jest.fn().mockReturnValue({ gte })
      const eq1 = jest.fn().mockReturnValue({ eq: eq2 })
      const select = jest.fn().mockReturnValue({ eq: eq1 })
      return { select, gte }
    }

    function membershipNamesQueryResult(result: { data: unknown; error: unknown }) {
      return {
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue(result)
        })
      }
    }

    it('should allow registration with no DB query when no requirement is set', async () => {
      const result = await RegistrationValidationService.validateMembershipRequirementAsync(
        asClient(mockSupabase),
        null,
        null,
        'user-123',
        seasonEndDate
      )

      expect(result.hasRequiredMembership).toBe(true)
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('should deny registration when the user has no membership that covers through the season end date', async () => {
      // The `.gte('valid_until', seasonEndDate)` filter is applied in the query itself,
      // so a membership that expires before the season end never comes back here.
      const membershipsQuery = membershipsQueryResult({ data: [], error: null })
      mockSupabase.from.mockReturnValueOnce(membershipsQuery)
      mockSupabase.from.mockReturnValueOnce(membershipNamesQueryResult({
        data: [{ id: 'standard-adult-id', name: 'Standard Adult' }],
        error: null
      }))

      const result = await RegistrationValidationService.validateMembershipRequirementAsync(
        asClient(mockSupabase),
        'standard-adult-id',
        null,
        'user-123',
        seasonEndDate
      )

      expect(result.hasRequiredMembership).toBe(false)
      expect(result.error).toContain('Standard Adult')

      // The core bug fix: the coverage cutoff passed to the DB must be the
      // season end date, not "today".
      expect(membershipsQuery.gte).toHaveBeenCalledWith('valid_until', seasonEndDate)
    })

    it('should allow registration when the user has a membership covering through the season end date', async () => {
      mockSupabase.from.mockReturnValueOnce(membershipsQueryResult({
        data: [{
          id: 'um-1',
          membership_id: 'standard-adult-id',
          valid_from: '2026-01-01',
          valid_until: '2027-12-31',
          payment_status: 'paid',
          memberships: { id: 'standard-adult-id', name: 'Standard Adult' }
        }],
        error: null
      }))

      const result = await RegistrationValidationService.validateMembershipRequirementAsync(
        asClient(mockSupabase),
        'standard-adult-id',
        null,
        'user-123',
        seasonEndDate
      )

      expect(result.hasRequiredMembership).toBe(true)
      expect(result.matchedMembership).toEqual({
        id: 'standard-adult-id',
        name: 'Standard Adult',
        source: 'registration'
      })
    })

    it('should allow registration via category-level membership when registration-level is not held (OR semantics)', async () => {
      mockSupabase.from.mockReturnValueOnce(membershipsQueryResult({
        data: [{
          id: 'um-1',
          membership_id: 'tournament-membership-id',
          valid_from: '2026-01-01',
          valid_until: '2027-12-31',
          payment_status: 'paid',
          memberships: { id: 'tournament-membership-id', name: 'Tournament Membership' }
        }],
        error: null
      }))

      const result = await RegistrationValidationService.validateMembershipRequirementAsync(
        asClient(mockSupabase),
        'standard-adult-id',
        'tournament-membership-id',
        'user-123',
        seasonEndDate
      )

      expect(result.hasRequiredMembership).toBe(true)
      expect(result.matchedMembership?.source).toBe('category')
    })
  })
})
