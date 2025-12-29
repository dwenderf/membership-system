/**
 * Tests for Registration Validation Service
 *
 * Tests critical business logic for registration eligibility:
 * - Preventing duplicate registrations
 * - Allowing re-registration after refund
 * - Payment method validation
 */

import { RegistrationValidationService } from '@/lib/services/registration-validation-service'

describe('RegistrationValidationService', () => {
  let mockSupabase: any

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
        mockSupabase,
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
        mockSupabase,
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
        mockSupabase,
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
          mockSupabase,
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
        mockSupabase,
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
        mockSupabase,
        'user-123'
      )

      expect(result.isValid).toBe(false)
      expect(result.error).toBe('User does not have a valid payment method')
    })

    it('should reject user with incomplete setup intent', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                stripe_payment_method_id: 'pm_123',
                setup_intent_status: 'processing' // Not succeeded
              },
              error: null
            })
          })
        })
      })

      const result = await RegistrationValidationService.validatePaymentMethod(
        mockSupabase,
        'user-123'
      )

      expect(result.isValid).toBe(false)
      expect(result.error).toBe('User does not have a valid payment method')
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
          mockSupabase,
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
        mockSupabase,
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
        mockSupabase,
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
        mockSupabase,
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
        mockSupabase,
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
        mockSupabase,
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
        mockSupabase,
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
        mockSupabase,
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
})
